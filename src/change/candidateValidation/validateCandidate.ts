import * as FileSystem from "@effect/platform/FileSystem";
import { Context, Effect, Layer } from "effect";
import type { AgentSessionJournal } from "../../agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { RestoreDisposableWorkspace } from "../../disposableWorkspace/disposableWorkspace.js";
import type { SubmitProgress } from "../../submission/submissionProgress.js";
import { runAcceptanceReviewPhase } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { ChangePolicy } from "../changePolicy.js";
import type { ChangeAgentSessionPort } from "../changePorts.js";
import { runSpecialistReviewPhase } from "../specialistReview/runSpecialistReviewPhase.js";
import type {
  StallDetectionRunGroup,
  StallDetector,
  StallDetectorResult,
} from "../stallDetection/stallDetector.js";
import type {
  CandidateValidationExecutionPort,
  ChangeValidationAgentSessionEntry,
} from "../validation/changeValidationPorts.js";
import type { CreateSnapshotWorkspace } from "../validation/createSnapshotWorkspace.js";
import { runCheckPhase } from "../validation/runCheckPhase.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import type { ActiveSnapshotWorkspace } from "../validation/snapshotWorkspace.js";
import { snapshotWorkspaceId } from "../validation/snapshotWorkspacePath.js";
import {
  SnapshotWorkspaceSetupFailed,
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import type {
  CandidateValidationAuthority,
  CandidateValidationOutcome,
  CandidateValidationRunRecord,
} from "./candidateValidationRunStore.js";
import { runCandidateValidationGate } from "./runCandidateValidationGate.js";

export type ValidateCandidateInput = {
  readonly candidateId: number;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly progress?: SubmitProgress;
};

type ValidateAcceptanceContextCandidateInput = ValidateCandidateInput;

type ValidateCandidateResult =
  | {
      readonly ok: true;
      readonly reused: boolean;
      readonly validationRunId: number;
      readonly outcome: CandidateValidationOutcome;
    }
  | {
      readonly ok: false;
      readonly code: "active_validation_run";
      readonly validationRunId: number;
    }
  | { readonly ok: false; readonly code: "blocked" }
  | {
      readonly ok: false;
      readonly validationRunId: number;
      readonly outcome: "tooling_failed";
    };

type CandidateValidationPathsValue = {
  readonly localRepositoryRoot: string;
  readonly localRepositoryCommonDirectory: string;
  readonly artifactsRoot: string;
  readonly agentSessionsRoot: string;
  readonly restoreWorkspace: RestoreDisposableWorkspace;
  readonly journal: ChangeAgentSessionPort["agentSessionJournal"];
  readonly getAgentSession: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
};

export class CandidateValidationPaths extends Context.Tag("CandidateValidationPaths")<
  CandidateValidationPaths,
  CandidateValidationPathsValue
>() {}

export class CandidateValidationExecution extends Context.Tag("CandidateValidationExecution")<
  CandidateValidationExecution,
  CandidateValidationExecutionPort
>() {}

export class CandidateValidationWorkspace extends Context.Tag("CandidateValidationWorkspace")<
  CandidateValidationWorkspace,
  CreateSnapshotWorkspace
>() {}

type CandidateReviewerExecutionValue = {
  readonly runtime: ReviewerAgentRuntime<ReviewerOutput>;
  readonly processExecutor: ReviewerProcessExecutor;
};

export class CandidateReviewerExecution extends Context.Tag("CandidateReviewerExecution")<
  CandidateReviewerExecution,
  CandidateReviewerExecutionValue
>() {}

export class StallDetectorExecution extends Context.Tag("StallDetectorExecution")<
  StallDetectorExecution,
  StallDetector
>() {}

export type StallDetectionEvaluation =
  | { readonly kind: "not_qualified" }
  | { readonly kind: "continue" }
  | {
      readonly kind: "stop";
      readonly reason: string;
      readonly validationRunIds: readonly number[];
    }
  | {
      readonly kind: "unavailable";
      readonly message: string;
      readonly validationRunIds: readonly number[];
    };

export type CandidateValidationService = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateAcceptanceContextCandidate: (
    input: ValidateAcceptanceContextCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly evaluateStallDetection: (input: {
    readonly changeId: string;
    readonly validationRunId: number;
    readonly policy: NonNullable<ChangePolicy["reviewerConfiguration"]["stallDetector"]>;
    readonly acceptanceContext: NonNullable<
      CandidateValidationAuthority["validationInput"]["acceptanceContext"]
    >;
    readonly acceptanceReview: NonNullable<
      ChangePolicy["reviewerConfiguration"]["acceptanceReview"]
    >;
  }) => Effect.Effect<StallDetectionEvaluation, RepositoryStorageError>;
  readonly listFindings: CandidateValidationExecutionPort["listFindings"];
  readonly listToolingFailures: CandidateValidationExecutionPort["listToolingFailures"];
  readonly listPhaseResults: (validationRunId: number) => Effect.Effect<
    readonly {
      readonly producer: string;
      readonly outcome: "passed" | "failed";
    }[],
    RepositoryStorageError
  >;
};

export class CandidateValidation extends Context.Tag("CandidateValidation")<
  CandidateValidation,
  CandidateValidationService
>() {}

export const CandidateValidationLive = Layer.effect(
  CandidateValidation,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const paths = yield* CandidateValidationPaths;
    const persistence = yield* CandidateValidationExecution;
    const reviewerExecution = yield* CandidateReviewerExecution;
    const stallDetector = yield* StallDetectorExecution;
    const createSnapshotWorkspace = yield* CandidateValidationWorkspace;
    return makeCandidateValidation({
      ...paths,
      fileSystem,
      persistence,
      reviewerExecution,
      createSnapshotWorkspace,
      stallDetector,
    });
  }),
);

const makeCandidateValidation = (dependencies: {
  readonly localRepositoryRoot: string;
  readonly localRepositoryCommonDirectory: string;
  readonly artifactsRoot: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly persistence: CandidateValidationExecutionPort;
  readonly reviewerExecution: CandidateReviewerExecutionValue;
  readonly createSnapshotWorkspace: CreateSnapshotWorkspace;
  readonly agentSessionsRoot: string;
  readonly restoreWorkspace: RestoreDisposableWorkspace;
  readonly journal: AgentSessionJournal<ChangeValidationAgentSessionEntry>;
  readonly getAgentSession: CandidateValidationPathsValue["getAgentSession"];
  readonly stallDetector: StallDetector;
}): CandidateValidationService => {
  const validate = Effect.fn("CandidateValidation.validate")(function* (
    input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  ) {
    const started = yield* dependencies.persistence.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      changeBaseSha: input.changeBaseSha,
    });
    if ("blocked" in started) {
      return { ok: false, code: "blocked" } as const;
    }
    if ("active" in started) {
      return {
        ok: false,
        code: "active_validation_run",
        validationRunId: started.validationRunId,
      } as const;
    }
    if (started.reused) {
      return {
        ok: true,
        reused: true,
        validationRunId: started.validationRunId,
        outcome: started.outcome,
      } as const;
    }

    const workspace = yield* dependencies.createSnapshotWorkspace({
      repositoryRoot: dependencies.localRepositoryRoot,
      repositoryCommonDirectory: dependencies.localRepositoryCommonDirectory,
      validationRunId: started.validationRunId,
      submittedSha: started.authority.candidate.headSha,
      recordWorkspaceCleanup: (cleanupResult) =>
        dependencies.persistence.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: cleanupResult.workspace,
          ...(cleanupResult.errorMessage === undefined
            ? {}
            : { cleanupBlockingReason: cleanupResult.errorMessage }),
        }),
      runInWorkspace: (activeWorkspace) =>
        runCandidatePhases(
          dependencies,
          input,
          started.authority,
          started.validationRunId,
          activeWorkspace,
        ),
    });

    if (!workspace.ok) {
      const cleanupResult =
        "toolingFailure" in workspace
          ? workspace.cleanupResult
          : workspace.toolingError.cleanupResult;
      const failure =
        "toolingFailure" in workspace
          ? validationToolingFailureRecord(workspace.toolingFailure)
          : validationToolingFailureRecord(
              new SnapshotWorkspaceSetupFailed({
                operationName: workspace.toolingError.operationName,
                validationRunId: workspace.toolingError.validationRunId,
                submittedSha: workspace.toolingError.expectedCommitSha,
                worktreePath: workspace.toolingError.worktreePath,
                errorMessage: workspace.toolingError.errorMessage,
                cleanupResult,
              }),
            );
      yield* dependencies.persistence.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...failure,
      });
      if (cleanupResult.workspace === "failed") {
        return {
          ok: false,
          code: "active_validation_run",
          validationRunId: started.validationRunId,
        } as const;
      }
      yield* dependencies.persistence.complete({
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
      });
      return {
        ok: false,
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
      } as const;
    }

    const outcome: CandidateValidationOutcome =
      workspace.activeWorkspaceResult?.outcome ?? "passed";
    yield* dependencies.persistence.complete({
      validationRunId: started.validationRunId,
      outcome,
    });
    return outcome === "tooling_failed"
      ? ({
          ok: false,
          validationRunId: started.validationRunId,
          outcome,
        } as const)
      : ({
          ok: true,
          reused: false,
          validationRunId: started.validationRunId,
          outcome,
        } as const);
  });

  return {
    validateCandidate: (input) => validate(input),
    validateAcceptanceContextCandidate: (input) => validate(input),
    evaluateStallDetection: (input) => evaluateStallDetection(dependencies, input),
    listFindings: dependencies.persistence.listFindings,
    listToolingFailures: dependencies.persistence.listToolingFailures,
    listPhaseResults: (validationRunId) =>
      Effect.map(dependencies.persistence.listPhaseResults(validationRunId), (results) =>
        results.map(({ producer, outcome }) => ({ producer, outcome })),
      ),
  };
};

const evaluateStallDetection = (
  dependencies: {
    readonly persistence: CandidateValidationExecutionPort;
    readonly stallDetector: StallDetector;
  },
  input: {
    readonly changeId: string;
    readonly validationRunId: number;
    readonly policy: NonNullable<ChangePolicy["reviewerConfiguration"]["stallDetector"]>;
    readonly acceptanceContext: NonNullable<
      CandidateValidationAuthority["validationInput"]["acceptanceContext"]
    >;
    readonly acceptanceReview: NonNullable<
      ChangePolicy["reviewerConfiguration"]["acceptanceReview"]
    >;
  },
): Effect.Effect<StallDetectionEvaluation, RepositoryStorageError> =>
  Effect.gen(function* () {
    const runs = yield* dependencies.persistence.listRunsForChange(input.changeId);
    const current = runs.find((run) => run.id === input.validationRunId);
    if (
      current === undefined ||
      current.outcome !== "blocked" ||
      runs.at(-1)?.id !== input.validationRunId
    ) {
      return { kind: "not_qualified" } as const;
    }

    let previousContext: string | undefined;
    const qualifying: CandidateValidationRunRecord[] = [];
    for (const run of runs) {
      const context = run.validationInput.acceptanceContext;
      const encodedContext = context === undefined ? undefined : JSON.stringify(context);
      if (
        encodedContext !== undefined &&
        previousContext !== undefined &&
        encodedContext !== previousContext
      ) {
        qualifying.length = 0;
      }
      if (encodedContext !== undefined) previousContext = encodedContext;
      if (run.outcome === "passed") {
        qualifying.length = 0;
      } else if (run.outcome === "blocked") {
        qualifying.push(run);
      }
    }
    if (qualifying.length < 3 || qualifying.at(-1)?.id !== input.validationRunId) {
      return { kind: "not_qualified" } as const;
    }

    const qualifyingRunIds = qualifying.map((run) => run.id);
    const findingsByRun = Map.groupBy(
      yield* dependencies.persistence.listFindingsForRuns(qualifyingRunIds),
      (finding) => finding.validationRunId,
    );
    const groups: StallDetectionRunGroup[] = qualifying.map((run) => ({
      validationRunId: run.id,
      findings: (findingsByRun.get(run.id) ?? []).map(
        ({ producer, title, description, evidence, files }) => ({
          producer,
          title,
          description,
          evidence,
          files,
        }),
      ),
    }));
    const judgment: StallDetectorResult = yield* dependencies.stallDetector.judge({
      acceptanceContext: input.acceptanceContext,
      runs: groups,
      model: input.acceptanceReview.profile.profile.runtimeConfig.model,
      ...(input.acceptanceReview.profile.profile.runtimeConfig.thinking === undefined ||
      input.acceptanceReview.profile.profile.runtimeConfig.thinking === "off"
        ? {}
        : { thinking: input.acceptanceReview.profile.profile.runtimeConfig.thinking }),
      policy: input.policy,
    });
    if (!judgment.ok) {
      return {
        kind: "unavailable",
        message: judgment.message,
        validationRunIds: qualifyingRunIds,
      } as const;
    }
    return judgment.decision === "stop"
      ? {
          kind: "stop",
          reason: judgment.reason,
          validationRunIds: qualifyingRunIds,
        }
      : { kind: "continue" as const };
  });

const runCandidatePhases = (
  dependencies: {
    readonly localRepositoryRoot: string;
    readonly localRepositoryCommonDirectory: string;
    readonly artifactsRoot: string;
    readonly fileSystem: FileSystem.FileSystem;
    readonly persistence: CandidateValidationExecutionPort;
    readonly reviewerExecution: CandidateReviewerExecutionValue;
    readonly agentSessionsRoot: string;
    readonly restoreWorkspace: RestoreDisposableWorkspace;
    readonly journal: CandidateValidationPathsValue["journal"];
    readonly getAgentSession: CandidateValidationPathsValue["getAgentSession"];
  },
  input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  authority: CandidateValidationAuthority,
  validationRunId: number,
  activeWorkspace: ActiveSnapshotWorkspace,
): Effect.Effect<
  { readonly outcome: CandidateValidationOutcome },
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    const changePolicy = authority.changePolicy;
    const agentEnvironment = changePolicy.reviewerConfiguration.agentEnvironment;
    const resourceRoot = activeWorkspace.worktreePath;
    const prepare = changePolicy.prepare;
    const acceptanceContext =
      authority.validationInput.acceptanceContext === undefined
        ? undefined
        : {
            version: authority.validationInput.acceptanceContext.version,
            title: authority.validationInput.acceptanceContext.title,
            description: authority.validationInput.acceptanceContext.description,
            ...(authority.validationInput.acceptanceContext.comments === undefined
              ? {}
              : { comments: [...authority.validationInput.acceptanceContext.comments] }),
            ...(authority.validationInput.acceptanceContext.resolutions === undefined
              ? {}
              : { resolutions: [...authority.validationInput.acceptanceContext.resolutions] }),
          };
    const acceptanceReview = changePolicy.reviewerConfiguration.acceptanceReview;
    const sessionOptions = {
      workspaceIdentity: {
        repositoryRoot: dependencies.localRepositoryRoot,
        repositoryCommonDirectory: dependencies.localRepositoryCommonDirectory,
        workspaceId: snapshotWorkspaceId(validationRunId),
      },
      sessionStorageRoot: dependencies.agentSessionsRoot,
      journal: dependencies.journal,
      getAgentSession: dependencies.getAgentSession,
    };
    return yield* runCandidateValidationGate({
      ...(prepare === null
        ? {}
        : {
            prepare: () =>
              runPreparePhase({
                validationRunId,
                prepare,
                commandExecutor: activeWorkspace.commandExecutor,
                artifactsRoot: dependencies.artifactsRoot,
                artifactMaxBytes: maxValidationArtifactBytes,
                commandCwd: activeWorkspace.worktreePath,
                expectedHeadSha: authority.candidate.headSha,
                allowedUntrackedFiles: [],
                ...(input.progress === undefined ? {} : { progress: input.progress }),
                recordPrepareResult: dependencies.persistence.recordPrepareResult,
              }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
          }),
      checks: () =>
        runCheckPhase({
          validationRunId,
          checks: changePolicy.checks,
          commandExecutor: activeWorkspace.commandExecutor,
          artifactsRoot: dependencies.artifactsRoot,
          artifactMaxBytes: maxValidationArtifactBytes,
          commandCwd: activeWorkspace.worktreePath,
          expectedHeadSha: authority.candidate.headSha,
          allowedUntrackedFiles: [],
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          continueAfterFinding: true,
          recordCheckResult: dependencies.persistence.recordCheckResult,
        }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
      ...(acceptanceContext === undefined || acceptanceReview === null
        ? {}
        : {
            acceptanceReview: () =>
              runAcceptanceReviewPhase({
                validationRunId,
                changeId: authority.candidate.changeId,
                candidate: candidateIdentity(authority),
                acceptanceContext,
                implementationDecisions: authority.implementationDecisions,
                blockerHistory: authority.blockerHistory,
                policy: acceptanceReview,
                ...(input.progress === undefined ? {} : { progress: input.progress }),
                ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
                runtime: dependencies.reviewerExecution.runtime,
                reviewerExecutor: dependencies.reviewerExecution.processExecutor,
                commandExecutor: activeWorkspace.commandExecutor,
                artifactsRoot: dependencies.artifactsRoot,
                artifactMaxBytes: maxValidationArtifactBytes,
                commandCwd: activeWorkspace.worktreePath,
                resourceRoot,
                restoreWorkspace: dependencies.restoreWorkspace,
                allowedUntrackedFiles: [],
                listArtifacts: dependencies.persistence.listArtifacts,
                listPreviousCandidateReviewerFindings:
                  dependencies.persistence.listPreviousCandidateReviewerFindings,
                recordAcceptanceResult: dependencies.persistence.recordAcceptanceResult,
                ...sessionOptions,
              }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
          }),
      specialistReviews: () =>
        runSpecialistReviewPhase({
          validationRunId,
          changeId: authority.candidate.changeId,
          candidate: candidateIdentity(authority),
          policies: changePolicy.reviewerConfiguration.specialistReviews,
          ...(acceptanceContext === undefined ? {} : { acceptanceContext }),
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
          runtime: dependencies.reviewerExecution.runtime,
          reviewerExecutor: dependencies.reviewerExecution.processExecutor,
          commandExecutor: activeWorkspace.commandExecutor,
          artifactsRoot: dependencies.artifactsRoot,
          artifactMaxBytes: maxValidationArtifactBytes,
          commandCwd: activeWorkspace.worktreePath,
          resourceRoot,
          restoreWorkspace: dependencies.restoreWorkspace,
          allowedUntrackedFiles: [],
          listArtifacts: dependencies.persistence.listArtifacts,
          listPreviousCandidateReviewerFindings:
            dependencies.persistence.listPreviousCandidateReviewerFindings,
          recordSpecialistResult: dependencies.persistence.recordSpecialistResult,
          ...sessionOptions,
        }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
    });
  }).pipe(Effect.withSpan("CandidateValidation.runPhases"));

const candidateIdentity = (authority: CandidateValidationAuthority) => ({
  candidateId: authority.candidate.id,
  changeBaseSha: authority.candidate.changeBaseSha,
  headSha: authority.candidate.headSha,
});
