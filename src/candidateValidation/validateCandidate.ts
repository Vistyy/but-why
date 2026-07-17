import { Effect } from "effect";

import type {
  CandidateValidationRunStore,
  CandidateValidationOutcome,
} from "./candidateValidationRunStore.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { createValidationWorkspace } from "../validation/createValidationWorkspace.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import {
  ValidationWorkspaceSetupFailed,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";

export type CandidateValidationPolicy = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly copyFiles: readonly string[];
};

export type CandidateValidation = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult>;
  readonly listRounds: CandidateValidationRunStore["listRounds"];
  readonly listFindings: CandidateValidationRunStore["listFindings"];
  readonly listArtifacts: CandidateValidationRunStore["listArtifacts"];
};

export type ValidateCandidateInput = {
  readonly candidateId: string;
  readonly headSha: string;
  readonly policy: CandidateValidationPolicy;
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
  readonly localRepositoryRoot: string;
  readonly artifactsRoot: string;
  readonly runStore: CandidateValidationRunStore;
}): CandidateValidation => ({
  validateCandidate: (validationInput) => validateCandidate(input, validationInput),
  listRounds: input.runStore.listRounds,
  listFindings: input.runStore.listFindings,
  listArtifacts: input.runStore.listArtifacts,
});

const validateCandidate = (
  dependencies: {
    readonly localRepositoryRoot: string;
    readonly artifactsRoot: string;
    readonly runStore: CandidateValidationRunStore;
  },
  input: ValidateCandidateInput,
): Effect.Effect<ValidateCandidateResult> =>
  Effect.gen(function* () {
    const started = dependencies.runStore.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      policy: input.policy,
      now: input.now,
    });
    if (started.reused) return { ok: true, ...started };

    const workspace = yield* createValidationWorkspace({
      repoRoot: dependencies.localRepositoryRoot,
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
              commandCwd: activeWorkspace.worktreePath,
              expectedHeadSha: input.headSha,
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
            commandCwd: activeWorkspace.worktreePath,
            expectedHeadSha: input.headSha,
            now: input.now,
            continueAfterFinding: true,
            recordCheckRound: dependencies.runStore.recordCheckRound,
          });
          return { validationFindings: checks.findings };
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
