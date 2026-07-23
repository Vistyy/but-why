import type { Sandbox } from "@ai-hero/sandcastle";
import { Context, Effect, Layer } from "effect";

import type { CandidateValidationOutcome } from "./candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../validation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { AcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import { runAcceptanceReviewPhase } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { SpecialistReviewPolicy } from "../specialistReview/specialistReviewConfig.js";
import { runSpecialistReviewPhase } from "../specialistReview/runSpecialistReviewPhase.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { createValidationWorkspace } from "../validation/createValidationWorkspace.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import {
  ValidationWorkspaceSetupFailed,
  validationToolingFailureRecord,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export type CandidateValidationPolicy = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly copyFiles: readonly string[];
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
};

export type TaskBackedCandidateValidationPolicy = CandidateValidationPolicy & {
  readonly acceptanceReview: AcceptanceReviewPolicy;
};

export type ValidateCandidateInput = {
  readonly candidateId: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly policy: CandidateValidationPolicy;
  readonly now: string;
};

type ValidateTaskBackedCandidateInput = {
  readonly candidateId: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly policy: TaskBackedCandidateValidationPolicy;
  readonly now: string;
};

type ValidateNoChangeInput = ValidateTaskBackedCandidateInput & {
  readonly noChange: true;
};

type ValidateCandidateResult =
  | {
      readonly ok: true;
      readonly reused: boolean;
      readonly validationRunId: string;
      readonly outcome: CandidateValidationOutcome;
    }
  | { readonly ok: false; readonly validationRunId: string; readonly outcome: "tooling_failed" };

type CandidateValidationPathsValue = {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
};

export class CandidateValidationPaths extends Context.Tag("CandidateValidationPaths")<
  CandidateValidationPaths,
  CandidateValidationPathsValue
>() {}

export class CandidateValidationPersistence extends Context.Tag("CandidateValidationPersistence")<
  CandidateValidationPersistence,
  ChangeValidationPersistence
>() {}

export class CandidateReviewerAgentRuntime extends Context.Tag("CandidateReviewerAgentRuntime")<
  CandidateReviewerAgentRuntime,
  ReviewerAgentRuntime
>() {}

export type CandidateValidationService = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateTaskBackedCandidate: (
    input: ValidateTaskBackedCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateNoChange?: (
    input: ValidateNoChangeInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly listFindings: ChangeValidationPersistence["listFindings"];
  readonly listToolingFailures: ChangeValidationPersistence["listToolingFailures"];
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
    const persistence = yield* CandidateValidationPersistence;
    const reviewerAgentRuntime = yield* CandidateReviewerAgentRuntime;
    return makeCandidateValidation({ ...paths, persistence, reviewerAgentRuntime });
  }),
);

const makeCandidateValidation = (dependencies: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: ChangeValidationPersistence;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime;
}): CandidateValidationService => {
  const validate = Effect.fn("CandidateValidation.validate")(function* (
    input: ValidateCandidateInput | ValidateTaskBackedCandidateInput | ValidateNoChangeInput,
  ) {
    const policy = "noChange" in input ? acceptanceOnlyPolicy(input.policy) : input.policy;
    const started = yield* dependencies.persistence.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      comparisonBaseSha: input.comparisonBaseSha,
      policy,
      now: input.now,
    });
    if (started.reused) return { ok: true, ...started } as const;

    const workspace = yield* createValidationWorkspace({
      repoRoot: dependencies.localRepositoryMainCheckoutRoot,
      validationRunId: started.validationRunId,
      submittedSha: input.headSha,
      copyFiles: input.policy.copyFiles,
      sandboxMode: input.policy.sandboxMode,
      runInWorkspace: (activeWorkspace) =>
        runCandidatePhases(dependencies, input, started.validationRunId, activeWorkspace),
    });

    if (!workspace.ok) {
      const failure =
        "toolingFailure" in workspace
          ? validationToolingFailureRecord(workspace.toolingFailure)
          : validationToolingFailureRecord(
              new ValidationWorkspaceSetupFailed({
                operationName: workspace.toolingError.operationName,
                tempRefName: workspace.toolingError.tempRefName,
                submittedSha: workspace.toolingError.submittedSha,
                ...(workspace.toolingError.worktreePath === undefined
                  ? {}
                  : { worktreePath: workspace.toolingError.worktreePath }),
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
      tempRefName: workspace.setup.tempRefName,
      submittedSha: workspace.setup.submittedSha,
      worktreeHead: workspace.setup.worktreeHead,
      cleanupWorktree: workspace.setup.cleanupResult.worktree,
      cleanupTempRef: workspace.setup.cleanupResult.tempRef,
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
    const outcome: CandidateValidationOutcome =
      toolingFailures.length > 0
        ? "tooling_failed"
        : activeResult?.validationFindings === 1
          ? "blocked"
          : "passed";
    yield* dependencies.persistence.complete({
      validationRunId: started.validationRunId,
      outcome,
      now: input.now,
    });
    return outcome === "tooling_failed"
      ? ({ ok: false, validationRunId: started.validationRunId, outcome } as const)
      : ({ ok: true, reused: false, validationRunId: started.validationRunId, outcome } as const);
  });

  return {
    validateCandidate: (input) => validate(input),
    validateTaskBackedCandidate: (input) => validate(input),
    validateNoChange: (input) => validate(input),
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
    readonly persistence: ChangeValidationPersistence;
    readonly reviewerAgentRuntime: ReviewerAgentRuntime;
  },
  input: ValidateCandidateInput | ValidateTaskBackedCandidateInput | ValidateNoChangeInput,
  validationRunId: string,
  activeWorkspace: {
    readonly sandbox: Pick<Sandbox, "exec" | "run">;
    readonly worktreePath: string;
  },
): Effect.Effect<
  {
    readonly validationFindings: 0 | 1;
    readonly toolingFailures?: readonly ValidationToolingFailure[];
  },
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.fn("CandidateValidation.runPhases")(function* () {
    if ("noChange" in input) {
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId,
        candidate: candidateIdentity(input),
        acceptanceContext: input.acceptanceContext,
        policy: input.policy.acceptanceReview,
        runtime: dependencies.reviewerAgentRuntime,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        allowedUntrackedFiles: input.policy.copyFiles,
        now: input.now,
        listArtifacts: dependencies.persistence.listArtifacts,
        listPreviousCandidateReviewerFindings:
          dependencies.persistence.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: dependencies.persistence.recordAcceptanceRound,
      });
      return { validationFindings: acceptance.findings };
    }
    if (input.policy.prepare !== undefined) {
      const prepare = yield* runPreparePhase({
        validationRunId,
        prepare: input.policy.prepare,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        expectedHeadSha: input.headSha,
        allowedUntrackedFiles: input.policy.copyFiles,
        now: input.now,
        recordPrepareRound: dependencies.persistence.recordPrepareRound,
      });
      if (prepare.findings === 1) return { validationFindings: 1 as const };
    }
    const checks = yield* runCheckPhase({
      validationRunId,
      checks: input.policy.checks,
      sandbox: activeWorkspace.sandbox,
      artifactsRoot: dependencies.artifactsRoot,
      artifactMaxBytes: maxValidationArtifactBytes,
      commandCwd: activeWorkspace.worktreePath,
      expectedHeadSha: input.headSha,
      allowedUntrackedFiles: input.policy.copyFiles,
      now: input.now,
      continueAfterFinding: true,
      recordCheckRound: dependencies.persistence.recordCheckRound,
    });
    if (checks.findings === 1) return { validationFindings: 1 as const };
    if ("acceptanceContext" in input) {
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId,
        candidate: candidateIdentity(input),
        acceptanceContext: input.acceptanceContext,
        policy: input.policy.acceptanceReview,
        runtime: dependencies.reviewerAgentRuntime,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        allowedUntrackedFiles: input.policy.copyFiles,
        now: input.now,
        listArtifacts: dependencies.persistence.listArtifacts,
        listPreviousCandidateReviewerFindings:
          dependencies.persistence.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: dependencies.persistence.recordAcceptanceRound,
      });
      if (acceptance.findings === 1) return { validationFindings: 1 as const };
    }
    const specialists = yield* runSpecialistReviewPhase({
      validationRunId,
      candidate: candidateIdentity(input),
      policies: input.policy.specialistReviews,
      runtime: dependencies.reviewerAgentRuntime,
      sandbox: activeWorkspace.sandbox,
      artifactsRoot: dependencies.artifactsRoot,
      artifactMaxBytes: maxValidationArtifactBytes,
      commandCwd: activeWorkspace.worktreePath,
      allowedUntrackedFiles: input.policy.copyFiles,
      now: input.now,
      listPreviousCandidateReviewerFindings:
        dependencies.persistence.listPreviousCandidateReviewerFindings,
      recordSpecialistRound: dependencies.persistence.recordSpecialistRound,
    });
    return {
      validationFindings: specialists.findings,
      toolingFailures: specialists.toolingFailures,
    };
  })();

const acceptanceOnlyPolicy = (
  policy: TaskBackedCandidateValidationPolicy,
): TaskBackedCandidateValidationPolicy => ({
  sandboxMode: policy.sandboxMode,
  checks: [],
  copyFiles: policy.copyFiles,
  specialistReviews: [],
  acceptanceReview: policy.acceptanceReview,
});

const candidateIdentity = (input: ValidateCandidateInput | ValidateTaskBackedCandidateInput) => ({
  candidateId: input.candidateId,
  comparisonBaseSha: input.comparisonBaseSha,
  headSha: input.headSha,
});
