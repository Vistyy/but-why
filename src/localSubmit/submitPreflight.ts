import { existsSync } from "node:fs";

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
import {
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "../submit/submitRejectionErrors.js";
import { ValidationWorkspaceSetupFailed } from "../validation/validationToolingFailures.js";

export type LocalSubmitPreflight = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskAuthorityTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
  readonly createValidationWorkspaceForValidationRun: (
    input: CreateLocalValidationWorkspaceForValidationRunInput,
  ) => Promise<CreateValidationWorkspaceForValidationRunResult>;
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
    readonly requireState?: boolean;
    readonly migrationTimestamp: () => string;
  },
): LoadLocalSubmitPreflightResult => {
  const repoContext = loadRepoLocalContext(cwd);

  if (!repoContext.ok) {
    switch (repoContext.error.code) {
      case "invalid_repo_config":
        return {
          ok: false,
          error: new RepoConfigValidationFailed({
            path: ".but-why/config.json",
            message: ".but-why/config.json is not valid But Why? repo config.",
          }),
        };
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

  return {
    ok: true,
    submit: localSubmitPreflight(repoContext.context, input.migrationTimestamp),
  };
};

const localSubmitPreflight = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): LocalSubmitPreflight => {
  const { taskStore, validationRuns, recordValidationWorkspaceSetup } = openRepoLocalStores(
    context,
    migrationTimestamp,
  );
  const taskAuthority = localTaskAuthority({ context, taskStore, validationRuns });
  const submissionEnvironment = localSubmissionEnvironment({ context });
  const submitPreflight = openSubmitPreflight({ taskAuthority, submissionEnvironment });

  return {
    taskPrefix: taskAuthority.taskPrefix,
    resolveTaskId: taskAuthority.resolveTaskId,
    submitTask: submitPreflight.submitTask,
    createValidationWorkspaceForValidationRun: (input) =>
      createValidationWorkspaceForValidationRun(
        taskAuthority,
        submissionEnvironment,
        recordValidationWorkspaceSetup,
        input,
      ),
  };
};

const createValidationWorkspaceForValidationRun = async (
  taskAuthority: TaskAuthority,
  submissionEnvironment: SubmissionEnvironment,
  recordValidationWorkspaceSetup: RepoLocalStores["recordValidationWorkspaceSetup"],
  input: CreateLocalValidationWorkspaceForValidationRunInput,
): Promise<CreateValidationWorkspaceForValidationRunResult> => {
  const result = await submissionEnvironment.createValidationWorkspaceForValidationRun({
    validationRunId: input.validationRunId,
    commitSha: input.commitSha,
    now: input.now,
  });

  if (result.ok) {
    recordValidationWorkspaceSetup(input.now, result.validationWorkspace);

    return result;
  }

  const toolingFailure = new ValidationWorkspaceSetupFailed({
    operationName: result.toolingError.operationName,
    tempRefName: result.toolingError.tempRefName,
    submittedSha: result.toolingError.submittedSha,
    ...(result.toolingError.worktreePath === undefined
      ? {}
      : { worktreePath: result.toolingError.worktreePath }),
    errorMessage: result.toolingError.errorMessage,
    cleanupResult: result.toolingError.cleanupResult,
  });

  const recovery = taskAuthority.recordValidationToolingFailure({
    validationRunId: input.validationRunId,
    toolingFailure,
    taskRecoveryState: input.taskRecoveryState,
    now: input.now,
  });

  if (!recovery.ok) {
    throw new Error(`Could not recover Task after validation tooling failure: ${recovery.code}`);
  }

  return result;
};

export type { SubmitTaskResult };
