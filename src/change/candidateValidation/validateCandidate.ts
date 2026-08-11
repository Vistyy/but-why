import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ReviewerOutput } from "../../contracts/reviewerOutput.js";
import type { AcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import { runAcceptanceReviewPhase } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { ReviewerSessionStore } from "../reviewerSession/reviewerSession.js";
import {
  runSpecialistReviewPhase,
  type SpecialistReviewerContinuityEvidence,
} from "../specialistReview/runSpecialistReviewPhase.js";
import type { SpecialistReviewPolicy } from "../specialistReview/specialistReviewConfig.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";
import { createSnapshotWorkspace } from "../validation/createSnapshotWorkspace.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import type { ActiveSnapshotWorkspace } from "../validation/snapshotWorkspace.js";
import { expectedSnapshotWorkspacePath } from "../validation/snapshotWorkspacePath.js";
import type { SubmitProgress } from "../validation/submitProgress.js";
import {
  SnapshotWorkspaceSetupFailed,
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import type { ReviewerExecutionEvidence } from "../validationRun/reviewerArtifacts.js";
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
  readonly candidateId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly resourceRoot?: string;
  readonly policy: CandidateValidationPolicy;
  readonly progress?: SubmitProgress;
  readonly now: string;
};

type ValidateAcceptanceContextCandidateInput = {
  readonly changeId: string;
  readonly candidateId: string;
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
      readonly validationRunId: string;
      readonly outcome: CandidateValidationOutcome;
      readonly reviewerEvidence?: ReviewerExecutionEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "active_validation_run";
      readonly validationRunId: string;
    }
  | { readonly ok: false; readonly code: "blocked" }
  | {
      readonly ok: false;
      readonly validationRunId: string;
      readonly outcome: "tooling_failed";
      readonly reviewerEvidence?: ReviewerExecutionEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    };

type CandidateValidationPathsValue = {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly reviewerSessionsRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
};

export class CandidateValidationPaths extends Context.Tag("CandidateValidationPaths")<
  CandidateValidationPaths,
  CandidateValidationPathsValue
>() {}

export class CandidateValidationExecution extends Context.Tag("CandidateValidationExecution")<
  CandidateValidationExecution,
  CandidateValidationExecutionPort
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
  readonly listRounds: (validationRunId: string) => Effect.Effect<
    readonly {
      readonly producer: string;
      readonly status: "passed" | "failed";
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
    const paths = yield* CandidateValidationPaths;
    const persistence = yield* CandidateValidationExecution;
    const reviewerExecution = yield* CandidateReviewerExecution;
    return makeCandidateValidation({ ...paths, persistence, reviewerExecution });
  }),
);

const makeCandidateValidation = (dependencies: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: CandidateValidationExecutionPort;
  readonly reviewerExecution: CandidateReviewerExecutionValue;
  readonly sessionStore?: ReviewerSessionStore;
  readonly reviewerSessionsRoot?: string;
}): CandidateValidationService => {
  const validate = Effect.fn("CandidateValidation.validate")(function* (
    input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  ) {
    const validationRunId = randomUUID();
    const started = yield* dependencies.persistence.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      changeBaseSha: input.changeBaseSha,
      policy: input.policy,
      validationRunId,
      workspaceSetup: {
        worktreePath: expectedSnapshotWorkspacePath(
          dependencies.localRepositoryMainCheckoutRoot,
          validationRunId,
        ),
      },
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
    if (started.reused) return { ok: true, ...started } as const;

    const workspace = yield* createSnapshotWorkspace({
      repoRoot: dependencies.localRepositoryMainCheckoutRoot,
      validationRunId: started.validationRunId,
      submittedSha: started.authority.candidate.headSha,
      copyFiles: started.authority.policy.copyFiles,
      recordWorkspaceSetup: (setup) =>
        dependencies.persistence.recordWorkspaceSetup({
          validationRunId: setup.validationRunId,
          expectedCommitSha: setup.expectedCommitSha,
          worktreePath: setup.worktreePath,
          cleanupWorkspace: setup.cleanupResult.workspace,
          now: input.now,
        }),
      recordInterruptedCleanupResult: (toolingError) =>
        dependencies.persistence
          .recordWorkspaceSetup({
            validationRunId: toolingError.validationRunId,
            expectedCommitSha: toolingError.expectedCommitSha,
            worktreePath: toolingError.worktreePath,
            cleanupWorkspace: toolingError.cleanupResult.workspace,
            now: input.now,
          })
          .pipe(Effect.ignore),
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
                cleanupResult: workspace.toolingError.cleanupResult,
              }),
            );
      yield* dependencies.persistence.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...failure,
        now: input.now,
      });
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

    yield* dependencies.persistence.recordWorkspaceSetup({
      validationRunId: started.validationRunId,
      expectedCommitSha: workspace.setup.expectedCommitSha,
      worktreePath: workspace.setup.worktreePath,
      cleanupWorkspace: workspace.setup.cleanupResult.workspace,
      now: input.now,
    });
    const activeResult = workspace.activeWorkspaceResult;
    const toolingFailures =
      (
        activeResult as
          | { readonly toolingFailures?: readonly ValidationToolingFailure[] }
          | undefined
      )?.toolingFailures ?? [];
    for (const toolingFailure of toolingFailures) {
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
          ...(activeResult?.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: activeResult.reviewerEvidence }),
          ...(activeResult?.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: activeResult.specialistReviewerEvidence }),
        } as const)
      : ({
          ok: true,
          reused: false,
          validationRunId: started.validationRunId,
          outcome,
          ...(activeResult?.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: activeResult.reviewerEvidence }),
          ...(activeResult?.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: activeResult.specialistReviewerEvidence }),
        } as const);
  });

  return {
    validateCandidate: (input) => validate(input),
    validateAcceptanceContextCandidate: (input) => validate(input),
    listFindings: dependencies.persistence.listFindings,
    listToolingFailures: dependencies.persistence.listToolingFailures,
    listRounds: (validationRunId) =>
      Effect.map(dependencies.persistence.listRounds(validationRunId), (rounds) =>
        rounds.map(({ producer, status }) => ({ producer, status })),
      ),
  };
};

const runCandidatePhases = (
  dependencies: {
    readonly artifactsRoot: string;
    readonly persistence: CandidateValidationExecutionPort;
    readonly reviewerExecution: CandidateReviewerExecutionValue;
    readonly sessionStore?: ReviewerSessionStore;
    readonly reviewerSessionsRoot?: string;
  },
  input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
  authority: CandidateValidationAuthority,
  validationRunId: string,
  activeWorkspace: ActiveSnapshotWorkspace,
): Effect.Effect<
  {
    readonly outcome: CandidateValidationOutcome;
    readonly reviewerEvidence?: ReviewerExecutionEvidence;
    readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
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
      ...(dependencies.sessionStore === undefined
        ? {}
        : { sessionStore: dependencies.sessionStore }),
      ...(dependencies.reviewerSessionsRoot === undefined
        ? {}
        : { sessionStorageRoot: dependencies.reviewerSessionsRoot }),
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
                recordPrepareRound: dependencies.persistence.recordPrepareRound,
              }),
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
          recordCheckRound: dependencies.persistence.recordCheckRound,
        }),
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
                recordAcceptanceRound: dependencies.persistence.recordAcceptanceRound,
                ...sessionOptions,
              }),
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
          recordSpecialistRound: dependencies.persistence.recordSpecialistRound,
          ...sessionOptions,
        }),
    });
  })();

const candidateIdentity = (authority: CandidateValidationAuthority) => ({
  candidateId: authority.candidate.id,
  changeBaseSha: authority.candidate.changeBaseSha,
  headSha: authority.candidate.headSha,
});
