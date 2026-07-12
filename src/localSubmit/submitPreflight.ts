import { existsSync } from "node:fs";

import { Effect } from "effect";

import { readGlobalConfig } from "../init/globalConfig.js";
import { requestCandidateOwnedSubmitValidation } from "../submit/candidateOwnedSubmitValidation.js";
import { openRepoLocalStores, type RepoLocalStores } from "../init/repoLocalStores.js";
import {
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import {
  openSubmitPreflight,
  type SubmitTaskInput,
  type SubmitTaskResult,
} from "../submit/submitPreflight.js";
import type { CreateValidationWorkspaceForValidationRunResult } from "../submissionEnvironment/submissionEnvironment.js";
import { localSubmissionEnvironment } from "../submissionEnvironment/localSubmissionEnvironment.js";
import type {
  TaskAuthority,
  TaskAuthorityTaskIdResolution,
} from "../taskAuthority/taskAuthority.js";
import { localTaskAuthority } from "../taskAuthority/localTaskAuthority.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { SubmissionEnvironment } from "../submissionEnvironment/submissionEnvironment.js";
import { submitRepoConfig, type SubmitRepoConfig } from "../submit/submitRepoConfig.js";
import type { SubmitRejectionError } from "../submit/submitRejectionErrors.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import {
  ValidationWorkspaceSetupFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";

export type LocalSubmitPreflight = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskAuthorityTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
  readonly createValidationWorkspaceForValidationRun: (
    input: CreateLocalValidationWorkspaceForValidationRunInput,
  ) => Effect.Effect<CreateValidationWorkspaceForValidationRunResult>;
};

export type LoadLocalSubmitPreflightResult =
  | {
      readonly ok: true;
      readonly submit: LocalSubmitPreflight;
    }
  | {
      readonly ok: false;
      readonly error: LoadLocalSubmitPreflightError;
    };

export type LoadLocalSubmitPreflightError =
  | Exclude<LoadRepoLocalContextError, { readonly code: "invalid_repo_config" }>
  | SubmitRejectionError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type CreateLocalValidationWorkspaceForValidationRunInput = {
  readonly validationRunId: string;
  readonly commitSha: string;
  readonly taskRecoveryState: SubmitEligibleState;
  readonly now: string;
};

export const loadLocalSubmitPreflight = (
  cwd: string,
  input: {
    readonly globalConfigPath: string;
    readonly requireState?: boolean;
    readonly migrationTimestamp: () => string;
  },
): LoadLocalSubmitPreflightResult => {
  const repoContext = loadRepoLocalContext(cwd);

  if (!repoContext.ok) {
    switch (repoContext.error.code) {
      case "invalid_repo_config":
        return { ok: false, error: repoContext.error.error };
      case "not_initialized":
        return { ok: false, error: repoContext.error };
    }
  }

  if (input.requireState !== false && !existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const globalConfig =
    input.requireState === false ? undefined : readGlobalConfig(input.globalConfigPath);

  if (globalConfig !== undefined && !globalConfig.ok) {
    return { ok: false, error: globalConfig.error };
  }

  const validationConfig =
    input.requireState === false
      ? undefined
      : submitRepoConfig(repoContext.context.config, globalConfig?.config ?? {});

  if (validationConfig !== undefined && !validationConfig.ok) {
    return { ok: false, error: validationConfig.error };
  }

  return {
    ok: true,
    submit: localSubmitPreflight(
      repoContext.context,
      input.migrationTimestamp,
      validationConfig?.config,
    ),
  };
};

const localSubmitPreflight = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
  validationConfig: SubmitRepoConfig | undefined,
): LocalSubmitPreflight => {
  const {
    taskStore,
    changeStore,
    candidateValidationRunStore,
    validationRuns,
    recordValidationWorkspaceSetup,
  } = openRepoLocalStores(context, migrationTimestamp);
  const taskAuthority = localTaskAuthority({ context, taskStore, validationRuns });
  const submissionEnvironment = localSubmissionEnvironment({ context });
  const submitPreflight = openSubmitPreflight({ taskAuthority, submissionEnvironment });
  const candidateExecution: CandidateExecution = { current: undefined };

  return {
    taskPrefix: taskAuthority.taskPrefix,
    resolveTaskId: taskAuthority.resolveTaskId,
    submitTask: (input) => {
      const candidateValidationRunId =
        validationConfig === undefined
          ? undefined
          : requestCandidateBeforeLegacySubmit({
              taskAuthority,
              submissionEnvironment,
              context,
              taskStore,
              changeStore,
              candidateValidationRunStore,
              candidateExecution,
              validationConfig,
              taskId: input.taskId,
              ...(input.automaticFixingOverride === undefined
                ? {}
                : { automaticFixingOverride: input.automaticFixingOverride }),
              now: input.now,
            });
      const result = submitPreflight.submitTask(input);
      return result.ok && candidateValidationRunId !== undefined
        ? { ...result, candidateValidationRunId }
        : result;
    },
    createValidationWorkspaceForValidationRun: (input) =>
      createValidationWorkspaceForValidationRun(
        taskAuthority,
        submissionEnvironment,
        recordValidationWorkspaceSetup,
        validationConfig,
        context,
        candidateValidationRunStore,
        candidateExecution,
        input,
      ),
  };
};

const requestCandidateBeforeLegacySubmit = (input: {
  readonly taskAuthority: TaskAuthority;
  readonly submissionEnvironment: SubmissionEnvironment;
  readonly context: RepoLocalContext;
  readonly taskStore: RepoLocalStores["taskStore"];
  readonly changeStore: RepoLocalStores["changeStore"];
  readonly candidateValidationRunStore: RepoLocalStores["candidateValidationRunStore"];
  readonly candidateExecution: CandidateExecution;
  readonly validationConfig: SubmitRepoConfig;
  readonly taskId: PublicTaskId;
  readonly automaticFixingOverride?: SubmitTaskInput["automaticFixingOverride"];
  readonly now: string;
}): string | undefined => {
  const readiness = input.taskAuthority.getTaskSubmitReadiness(input.taskId);
  if (!readiness.ok) return undefined;
  if (!input.submissionEnvironment.readSubmittedCodeCandidate().ok) return undefined;

  const candidateRequest = requestCandidateOwnedSubmitValidation({
    context: input.context,
    taskStore: input.taskStore,
    changeStore: input.changeStore,
    candidateValidationRunStore: input.candidateValidationRunStore,
    validationConfig: input.validationConfig,
    taskId: input.taskId,
    ...(input.automaticFixingOverride === undefined
      ? {}
      : { automaticFixingOverride: input.automaticFixingOverride }),
    now: input.now,
  });
  if (!candidateRequest.ok) return undefined;

  const lease = input.candidateValidationRunStore.acquireLease({
    validationRunId: candidateRequest.run.id,
    holderId: "by-submit",
    now: input.now,
    nowMs: Date.parse(input.now),
  });
  if (!lease.ok) return undefined;
  input.candidateExecution.current = {
    validationRunId: candidateRequest.run.id,
    leaseToken: lease.lease.leaseToken,
  };
  return candidateRequest.run.id;
};

type CandidateExecution = {
  current:
    | {
        readonly validationRunId: string;
        readonly leaseToken: string;
      }
    | undefined;
};

const createValidationWorkspaceForValidationRun = (
  taskAuthority: TaskAuthority,
  submissionEnvironment: SubmissionEnvironment,
  recordValidationWorkspaceSetup: RepoLocalStores["recordValidationWorkspaceSetup"],
  validationConfig: SubmitRepoConfig | undefined,
  context: RepoLocalContext,
  candidateValidationRunStore: RepoLocalStores["candidateValidationRunStore"],
  candidateExecution: CandidateExecution,
  input: CreateLocalValidationWorkspaceForValidationRunInput,
): Effect.Effect<CreateValidationWorkspaceForValidationRunResult> =>
  Effect.gen(function* () {
    if (validationConfig === undefined) {
      throw new Error(
        "Submit validation config must be loaded before creating a Validation Workspace.",
      );
    }

    const result = yield* submissionEnvironment.createValidationWorkspaceForValidationRun({
      validationRunId: input.validationRunId,
      commitSha: input.commitSha,
      sandboxMode: validationConfig.sandboxMode,
      now: input.now,
      runInWorkspace: (workspace) =>
        Effect.gen(function* () {
          if (validationConfig.prepare === undefined) {
            recordPhaseStatus(taskAuthority, {
              validationRunId: input.validationRunId,
              phase: "prepare",
              status: "skipped",
              errorMessage: "Prepare is not configured.",
              now: input.now,
            });
          } else {
            const prepareResult = yield* runPreparePhase({
              validationRunId: input.validationRunId,
              prepare: validationConfig.prepare,
              sandbox: workspace.sandbox,
              repoRoot: context.root,
              commandCwd: workspace.worktreePath,
              now: input.now,
              recordPrepareRound: (prepareRoundInput) => {
                const recordResult = taskAuthority.recordPrepareRound(prepareRoundInput);

                if (!recordResult.ok) {
                  throw new Error(`Could not record prepare round: ${recordResult.code}`);
                }
              },
            }).pipe(
              Effect.catchAll((toolingFailure) =>
                Effect.zipRight(
                  Effect.sync(() => {
                    recordPhaseStatus(taskAuthority, {
                      validationRunId: input.validationRunId,
                      phase: "prepare",
                      status: "workflow_failed",
                      errorMessage: "Prepare command tooling failed.",
                      now: input.now,
                    });
                  }),
                  Effect.fail(toolingFailure),
                ),
              ),
            );

            if (prepareResult.findings === 1) {
              recordSkippedPhasesAfterPrepareFailure(taskAuthority, input);

              return { validationFindings: 1 as const };
            }
          }

          const checkResult = yield* runCheckPhase({
            validationRunId: input.validationRunId,
            checks: validationConfig.checks,
            sandbox: workspace.sandbox,
            repoRoot: context.root,
            commandCwd: workspace.worktreePath,
            now: input.now,
            recordCheckRound: (checkRoundInput) => {
              const recordResult = taskAuthority.recordCheckRound(checkRoundInput);

              if (!recordResult.ok) {
                throw new Error(`Could not record check round: ${recordResult.code}`);
              }
            },
          });

          return { validationFindings: checkResult.findings };
        }),
      recordInterruptedCleanupResult: (toolingError) =>
        Effect.sync(() => {
          recordValidationWorkspaceToolingFailure(taskAuthority, input, toolingError);
        }),
    });

    if (result.ok) {
      recordValidationWorkspaceSetup(input.now, result.validationWorkspace);
      settleCandidateExecution(
        candidateValidationRunStore,
        candidateExecution,
        input,
        result.activeWorkspaceResult?.validationFindings === 1 ? "blocked" : "passed",
      );
      return result;
    }

    if ("toolingFailure" in result) {
      recordValidationToolingFailure(taskAuthority, input, result.toolingFailure);
      settleCandidateExecution(
        candidateValidationRunStore,
        candidateExecution,
        input,
        "tooling_failed",
      );
      return result;
    }

    recordValidationWorkspaceToolingFailure(taskAuthority, input, result.toolingError);
    settleCandidateExecution(
      candidateValidationRunStore,
      candidateExecution,
      input,
      "tooling_failed",
    );
    return result;
  });

const settleCandidateExecution = (
  store: RepoLocalStores["candidateValidationRunStore"],
  execution: CandidateExecution,
  input: CreateLocalValidationWorkspaceForValidationRunInput,
  outcome: "passed" | "blocked" | "tooling_failed",
): void => {
  const current = execution.current;
  if (current === undefined) return;
  const recorded = store.recordEvidence({
    validationRunId: current.validationRunId,
    leaseToken: current.leaseToken,
    phase: "checks",
    producer: "task-submit-execution-bridge",
    phaseStatus: outcome === "passed" ? "passed" : "incomplete",
    evidence: { legacyValidationRunId: input.validationRunId, outcome },
    outcome,
    now: input.now,
  });
  execution.current = undefined;
  if (!recorded.ok) {
    throw new Error(`Could not record Candidate Validation Run outcome: ${recorded.code}`);
  }
};

const skippedPhasesAfterPrepareFailure = [
  "checks",
  "intent_review",
  "quality_review",
  "publish_pr",
  "watch_pr",
] as const;

const recordSkippedPhasesAfterPrepareFailure = (
  taskAuthority: TaskAuthority,
  input: CreateLocalValidationWorkspaceForValidationRunInput,
): void => {
  for (const phase of skippedPhasesAfterPrepareFailure) {
    recordPhaseStatus(taskAuthority, {
      validationRunId: input.validationRunId,
      phase,
      status: "skipped",
      errorMessage: "Prepare did not pass.",
      now: input.now,
    });
  }
};

const recordPhaseStatus = (
  taskAuthority: TaskAuthority,
  input: Parameters<TaskAuthority["recordPhaseStatus"]>[0],
): void => {
  const recordResult = taskAuthority.recordPhaseStatus(input);

  if (!recordResult.ok) {
    throw new Error(`Could not record validation phase status: ${recordResult.code}`);
  }
};

const recordValidationWorkspaceToolingFailure = (
  taskAuthority: TaskAuthority,
  input: CreateLocalValidationWorkspaceForValidationRunInput,
  toolingError: NonNullable<
    Extract<
      CreateValidationWorkspaceForValidationRunResult,
      { readonly toolingError: unknown }
    >["toolingError"]
  >,
): void => {
  const toolingFailure = new ValidationWorkspaceSetupFailed({
    operationName: toolingError.operationName,
    tempRefName: toolingError.tempRefName,
    submittedSha: toolingError.submittedSha,
    ...(toolingError.worktreePath === undefined ? {} : { worktreePath: toolingError.worktreePath }),
    errorMessage: toolingError.errorMessage,
    cleanupResult: toolingError.cleanupResult,
  });

  recordValidationToolingFailure(taskAuthority, input, toolingFailure);
};

const recordValidationToolingFailure = (
  taskAuthority: TaskAuthority,
  input: CreateLocalValidationWorkspaceForValidationRunInput,
  toolingFailure: ValidationToolingFailure,
): void => {
  const recovery = taskAuthority.recordValidationToolingFailure({
    validationRunId: input.validationRunId,
    toolingFailure,
    taskRecoveryState: input.taskRecoveryState,
    now: input.now,
  });

  if (!recovery.ok) {
    throw new Error(`Could not recover Task after validation tooling failure: ${recovery.code}`);
  }
};

export type { SubmitTaskResult };
