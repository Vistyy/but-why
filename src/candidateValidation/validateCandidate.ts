import { Effect } from "effect";

import type {
  CandidateValidationRunStore,
  CandidateValidationOutcome,
} from "./candidateValidationRunStore.js";
import type { AcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../agent/reviewerAgentRuntime.js";
import { runAcceptanceReviewPhase } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { createValidationWorkspace } from "../validation/createValidationWorkspace.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import {
  ValidationWorkspaceSetupFailed,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export type CandidateValidationPolicy = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly copyFiles: readonly string[];
};

export type TaskBackedCandidateValidationPolicy = CandidateValidationPolicy & {
  readonly acceptanceReview: AcceptanceReviewPolicy;
};

export type CandidateValidation = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult>;
  readonly validateTaskBackedCandidate: (
    input: ValidateTaskBackedCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult>;
  readonly listRounds: (
    validationRunId: string,
  ) => readonly { readonly producer: string; readonly status: "passed" | "failed" }[];
  readonly listFindings: CandidateValidationRunStore["listFindings"];
  readonly listArtifacts: CandidateValidationRunStore["listArtifacts"];
  readonly listToolingFailures: CandidateValidationRunStore["listToolingFailures"];
};

export type ValidateCandidateInput = {
  readonly candidateId: string;
  readonly headSha: string;
  readonly policy: CandidateValidationPolicy;
  readonly now: string;
};

export type ValidateTaskBackedCandidateInput = {
  readonly candidateId: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly policy: TaskBackedCandidateValidationPolicy;
  readonly now: string;
};

export type ValidateCandidateResult =
  | {
      readonly ok: true;
      readonly reused: boolean;
      readonly validationRunId: string;
      readonly outcome: CandidateValidationOutcome;
    }
  | { readonly ok: false; readonly validationRunId: string; readonly outcome: "tooling_failed" };

export const openCandidateValidation = (input: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStore;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): CandidateValidation => {
  const dependencies = {
    ...input,
    reviewerAgentRuntime: input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
  };
  return {
    validateCandidate: (validationInput) => validateCandidate(dependencies, validationInput),
    validateTaskBackedCandidate: (validationInput) =>
      validateCandidate(dependencies, validationInput),
    listRounds: (validationRunId) =>
      input.runStore
        .listRounds(validationRunId)
        .map(({ producer, status }) => ({ producer, status })),
    listFindings: input.runStore.listFindings,
    listArtifacts: input.runStore.listArtifacts,
    listToolingFailures: input.runStore.listToolingFailures,
  };
};

const validateCandidate = (
  dependencies: {
    readonly localRepositoryMainCheckoutRoot: string;
    readonly artifactsRoot: string;
    readonly runStore: CandidateValidationRunStore;
    readonly reviewerAgentRuntime: ReviewerAgentRuntime;
  },
  input: ValidateCandidateInput | ValidateTaskBackedCandidateInput,
): Effect.Effect<ValidateCandidateResult> =>
  Effect.gen(function* () {
    const started = dependencies.runStore.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      ...("comparisonBaseSha" in input ? { comparisonBaseSha: input.comparisonBaseSha } : {}),
      policy: input.policy,
      now: input.now,
    });
    if (started.reused) return { ok: true, ...started };

    const workspace = yield* createValidationWorkspace({
      repoRoot: dependencies.localRepositoryMainCheckoutRoot,
      validationRunId: started.validationRunId,
      submittedSha: input.headSha,
      copyFiles: input.policy.copyFiles,
      sandboxMode: input.policy.sandboxMode,
      runInWorkspace: (activeWorkspace) =>
        Effect.gen(function* () {
          if (input.policy.prepare !== undefined) {
            const prepare = yield* runPreparePhase({
              validationRunId: started.validationRunId,
              prepare: input.policy.prepare,
              sandbox: activeWorkspace.sandbox,
              artifactsRoot: dependencies.artifactsRoot,
              artifactMaxBytes: maxValidationArtifactBytes,
              commandCwd: activeWorkspace.worktreePath,
              expectedHeadSha: input.headSha,
              allowedUntrackedFiles: input.policy.copyFiles,
              now: input.now,
              recordPrepareRound: dependencies.runStore.recordPrepareRound,
            });
            if (prepare.findings === 1) return { validationFindings: 1 as const };
          }
          const checks = yield* runCheckPhase({
            validationRunId: started.validationRunId,
            checks: input.policy.checks,
            sandbox: activeWorkspace.sandbox,
            artifactsRoot: dependencies.artifactsRoot,
            artifactMaxBytes: maxValidationArtifactBytes,
            commandCwd: activeWorkspace.worktreePath,
            expectedHeadSha: input.headSha,
            allowedUntrackedFiles: input.policy.copyFiles,
            now: input.now,
            continueAfterFinding: true,
            recordCheckRound: dependencies.runStore.recordCheckRound,
          });
          if (checks.findings === 1 || !("acceptanceContext" in input)) {
            return { validationFindings: checks.findings };
          }
          const acceptance = yield* runAcceptanceReviewPhase({
            validationRunId: started.validationRunId,
            candidate: {
              candidateId: input.candidateId,
              comparisonBaseSha: input.comparisonBaseSha,
              headSha: input.headSha,
            },
            acceptanceContext: input.acceptanceContext,
            policy: input.policy.acceptanceReview,
            runtime: dependencies.reviewerAgentRuntime,
            sandbox: activeWorkspace.sandbox,
            artifactsRoot: dependencies.artifactsRoot,
            artifactMaxBytes: maxValidationArtifactBytes,
            commandCwd: activeWorkspace.worktreePath,
            allowedUntrackedFiles: input.policy.copyFiles,
            now: input.now,
            recordAcceptanceRound: dependencies.runStore.recordAcceptanceRound,
          });
          return { validationFindings: acceptance.findings };
        }),
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
      dependencies.runStore.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...failure,
        now: input.now,
      });
      dependencies.runStore.complete({
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
        now: input.now,
      });
      return { ok: false, validationRunId: started.validationRunId, outcome: "tooling_failed" };
    }

    dependencies.runStore.recordWorkspaceSetup({
      validationRunId: started.validationRunId,
      tempRefName: workspace.setup.tempRefName,
      submittedSha: workspace.setup.submittedSha,
      worktreeHead: workspace.setup.worktreeHead,
      cleanupWorktree: workspace.setup.cleanupResult.worktree,
      cleanupTempRef: workspace.setup.cleanupResult.tempRef,
      now: input.now,
    });
    const outcome: CandidateValidationOutcome =
      workspace.activeWorkspaceResult?.validationFindings === 1 ? "blocked" : "passed";
    dependencies.runStore.complete({
      validationRunId: started.validationRunId,
      outcome,
      now: input.now,
    });
    return { ok: true, reused: false, validationRunId: started.validationRunId, outcome };
  });
