import * as FileSystem from "@effect/platform/FileSystem";
import { Context, Effect, Layer } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type {
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { SubmitProgress } from "../../submission/submissionProgress.js";
import type { AcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import { runAcceptanceReviewPhase } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import { runSpecialistReviewPhase } from "../specialistReview/runSpecialistReviewPhase.js";
import type { SpecialistReviewPolicy } from "../specialistReview/specialistReviewConfig.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";
import type { CreateSnapshotWorkspace } from "../validation/createSnapshotWorkspace.js";
import { runCheckPhase } from "../validation/runCheckPhase.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import type { ActiveSnapshotWorkspace } from "../validation/snapshotWorkspace.js";
import {
  SnapshotWorkspaceSetupFailed,
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import type {
  CandidateValidationAuthority,
  CandidateValidationOutcome,
} from "./candidateValidationRunStore.js";
import { runCandidateValidationGate } from "./runCandidateValidationGate.js";

export type CandidateValidationPolicy = {
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly copyFiles: readonly string[];
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
};

export type AcceptanceContextCandidateValidationPolicy = CandidateValidationPolicy & {
  readonly acceptanceReview: AcceptanceReviewPolicy;
};

export type ValidateCandidateInput = {
  readonly changeId: string;
  readonly candidateId: number;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly resourceRoot?: string;
  readonly policy: CandidateValidationPolicy;
  readonly progress?: SubmitProgress;
  readonly now: string;
};

type ValidateAcceptanceContextCandidateInput = {
  readonly changeId: string;
  readonly candidateId: number;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly resourceRoot?: string;
  readonly progress?: SubmitProgress;
  readonly policy: AcceptanceContextCandidateValidationPolicy;
  readonly now: string;
};

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
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly agentSessionsRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly getAgentSession: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
  readonly linkAgentInvocation: (input: {
    readonly changeId: string;
    readonly producer: string;
    readonly validationRunId: number;
    readonly phase: string;
  }) => AgentSessionSqlLink;
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

export type CandidateValidationService = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateAcceptanceContextCandidate: (
    input: ValidateAcceptanceContextCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
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
    const createSnapshotWorkspace = yield* CandidateValidationWorkspace;
    return makeCandidateValidation({
      ...paths,
      fileSystem,
      persistence,
      reviewerExecution,
      createSnapshotWorkspace,
    });
  }),
);

const makeCandidateValidation = (dependencies: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly persistence: CandidateValidationExecutionPort;
  readonly reviewerExecution: CandidateReviewerExecutionValue;
  readonly createSnapshotWorkspace: CreateSnapshotWorkspace;
  readonly agentSessionsRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly getAgentSession: CandidateValidationPathsValue["getAgentSession"];
  readonly linkAgentInvocation: CandidateValidationPathsValue["linkAgentInvocation"];
}): CandidateValidationService => {
  const validate = Effect.fn("CandidateValidation.validate")(function* (
    input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  ) {
    const started = yield* dependencies.persistence.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      changeBaseSha: input.changeBaseSha,
      policy: input.policy,
      now: input.now,
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
      repoRoot: dependencies.localRepositoryMainCheckoutRoot,
      validationRunId: started.validationRunId,
      submittedSha: started.authority.candidate.headSha,
      copyFiles: started.authority.policy.copyFiles,
      recordWorkspaceCleanup: (cleanupResult) =>
        dependencies.persistence.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: cleanupResult.workspace,
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
        now: input.now,
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
        now: input.now,
      });
      return {
        ok: false,
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
      } as const;
    }

    const activeResult = workspace.activeWorkspaceResult;
    const toolingFailures =
      (
        activeResult as
          | { readonly toolingFailures?: readonly ValidationToolingFailure[] }
          | undefined
      )?.toolingFailures ?? [];
    const persistedToolingFailures = activeResult?.persistedToolingFailures ?? [];
    for (const toolingFailure of toolingFailures) {
      if (persistedToolingFailures.includes(toolingFailure)) continue;
      yield* dependencies.persistence.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...validationToolingFailureRecord(toolingFailure),
        now: input.now,
      });
    }
    const outcome: CandidateValidationOutcome = activeResult?.outcome ?? "passed";
    yield* dependencies.persistence.complete({
      validationRunId: started.validationRunId,
      outcome,
      now: input.now,
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
    listFindings: dependencies.persistence.listFindings,
    listToolingFailures: dependencies.persistence.listToolingFailures,
    listPhaseResults: (validationRunId) =>
      Effect.map(dependencies.persistence.listPhaseResults(validationRunId), (results) =>
        results.map(({ producer, outcome }) => ({ producer, outcome })),
      ),
  };
};

const runCandidatePhases = (
  dependencies: {
    readonly artifactsRoot: string;
    readonly fileSystem: FileSystem.FileSystem;
    readonly persistence: CandidateValidationExecutionPort;
    readonly reviewerExecution: CandidateReviewerExecutionValue;
    readonly agentSessionsRoot: string;
    readonly agentPersistence: AgentSessionPersistence;
    readonly getAgentSession: CandidateValidationPathsValue["getAgentSession"];
    readonly linkAgentInvocation: CandidateValidationPathsValue["linkAgentInvocation"];
  },
  input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  authority: CandidateValidationAuthority,
  validationRunId: number,
  activeWorkspace: ActiveSnapshotWorkspace,
): Effect.Effect<
  {
    readonly outcome: CandidateValidationOutcome;
    readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
    readonly toolingFailures: readonly ValidationToolingFailure[];
  },
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.fn("CandidateValidation.runPhases")(function* () {
    const policy = authority.policy;
    const agentEnvironment = policy.agentEnvironment;
    const resourceRoot = activeWorkspace.worktreePath;
    const prepare = policy.prepare;
    const acceptanceContext =
      policy.acceptanceContext === undefined
        ? undefined
        : {
            version: policy.acceptanceContext.version,
            title: policy.acceptanceContext.title,
            description: policy.acceptanceContext.description,
            ...(policy.acceptanceContext.comments === undefined
              ? {}
              : { comments: [...policy.acceptanceContext.comments] }),
            ...(policy.acceptanceContext.resolutions === undefined
              ? {}
              : { resolutions: [...policy.acceptanceContext.resolutions] }),
          };
    const acceptanceReview = policy.acceptanceReview;
    const sessionOptions = {
      sessionStorageRoot: dependencies.agentSessionsRoot,
      agentPersistence: dependencies.agentPersistence,
      getAgentSession: dependencies.getAgentSession,
      linkAgentInvocation: dependencies.linkAgentInvocation,
      settleAgentInvocationResult: dependencies.persistence.settleAgentInvocationResult,
    };
    return yield* runCandidateValidationGate({
      ...(prepare === undefined
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
                allowedUntrackedFiles: policy.copyFiles,
                ...(input.progress === undefined ? {} : { progress: input.progress }),
                now: input.now,
                recordPrepareResult: dependencies.persistence.recordPrepareResult,
              }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
          }),
      checks: () =>
        runCheckPhase({
          validationRunId,
          checks: policy.checks,
          commandExecutor: activeWorkspace.commandExecutor,
          artifactsRoot: dependencies.artifactsRoot,
          artifactMaxBytes: maxValidationArtifactBytes,
          commandCwd: activeWorkspace.worktreePath,
          expectedHeadSha: authority.candidate.headSha,
          allowedUntrackedFiles: policy.copyFiles,
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          now: input.now,
          continueAfterFinding: true,
          recordCheckResult: dependencies.persistence.recordCheckResult,
        }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
      ...(acceptanceContext === undefined || acceptanceReview === undefined
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
                allowedUntrackedFiles: policy.copyFiles,
                now: input.now,
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
          policies: policy.specialistReviews ?? [],
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
          allowedUntrackedFiles: policy.copyFiles,
          now: input.now,
          listArtifacts: dependencies.persistence.listArtifacts,
          listPreviousCandidateReviewerFindings:
            dependencies.persistence.listPreviousCandidateReviewerFindings,
          recordSpecialistResult: dependencies.persistence.recordSpecialistResult,
          ...sessionOptions,
        }).pipe(Effect.provideService(FileSystem.FileSystem, dependencies.fileSystem)),
    });
  })();

const candidateIdentity = (authority: CandidateValidationAuthority) => ({
  candidateId: authority.candidate.id,
  changeBaseSha: authority.candidate.changeBaseSha,
  headSha: authority.candidate.headSha,
});
