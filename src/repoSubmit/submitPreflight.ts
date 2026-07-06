import { existsSync } from "node:fs";

import {
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import type { RunStore } from "../run/runStore.js";
import { openSqliteRunStore } from "../sqlite/sqliteRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../sqlite/sqliteValidationRuns.js";
import {
  openSubmitPreflight,
  type SubmitTaskInput,
  type SubmitTaskResult,
} from "../submit/submitPreflight.js";
import { taskStoreSubmitReadiness } from "../submit/submitReadiness.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import {
  createValidationWorkspace,
  type ValidationWorkspaceSetup,
  type ValidationWorkspaceToolingError,
} from "../validation/createValidationWorkspace.js";
import type { ValidationRuns } from "../validation/validationRuns.js";

export type RepoSubmitPreflight = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
  readonly createValidationWorkspaceForRun: (
    input: CreateValidationWorkspaceForRunInput,
  ) => Promise<CreateValidationWorkspaceForRunResult>;
};

export type LoadRepoSubmitPreflightResult =
  | {
      readonly ok: true;
      readonly submit: RepoSubmitPreflight;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoSubmitPreflightError;
    };

export type LoadRepoSubmitPreflightError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type CreateValidationWorkspaceForRunInput = {
  readonly runId: string;
  readonly commitSha: string;
  readonly taskRecoveryState: SubmitEligibleState;
  readonly now: string;
};

export type CreateValidationWorkspaceForRunResult =
  | {
      readonly ok: true;
      readonly validationWorkspace: ValidationWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly toolingError: ValidationWorkspaceToolingError;
    };

export const loadRepoSubmitPreflight = (
  cwd: string,
  input: {
    readonly requireState?: boolean;
    readonly migrationTimestamp: () => string;
  },
): LoadRepoSubmitPreflightResult => {
  const repoContext = loadRepoLocalContext(cwd);

  if (!repoContext.ok) {
    return repoContext;
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
    submit: repoSubmitPreflight(repoContext.context, input.migrationTimestamp),
  };
};

const repoSubmitPreflight = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): RepoSubmitPreflight => {
  const taskStore = openSqliteTaskStore({
    statePath: context.paths.statePath,
    taskPrefix: context.taskPrefix,
    migrationTimestamp,
  });
  const validationRuns = openSqliteValidationRuns({
    statePath: context.paths.statePath,
    migrationTimestamp,
  });
  const runStore = openSqliteRunStore({
    statePath: context.paths.statePath,
    migrationTimestamp,
  });
  const submitPreflight = openSubmitPreflight({
    root: context.root,
    submitReadiness: taskStoreSubmitReadiness(taskStore),
    validationRuns,
    allowedUntrackedFiles: context.config.validationWorkspace?.copyFiles ?? [],
  });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    submitTask: submitPreflight.submitTask,
    createValidationWorkspaceForRun: (input) =>
      createValidationWorkspaceForRun(context, runStore, validationRuns, input),
  };
};

const createValidationWorkspaceForRun = async (
  context: RepoLocalContext,
  runStore: RunStore,
  validationRuns: ValidationRuns,
  input: CreateValidationWorkspaceForRunInput,
): Promise<CreateValidationWorkspaceForRunResult> => {
  const result = await createValidationWorkspace({
    repoRoot: context.root,
    runId: input.runId,
    submittedSha: input.commitSha,
    copyFiles: context.config.validationWorkspace?.copyFiles ?? [],
  });

  if (result.ok) {
    runStore.recordValidationWorkspaceSetup({
      runId: input.runId,
      tempRefName: result.setup.tempRefName,
      submittedSha: result.setup.submittedSha,
      worktreePath: result.setup.worktreePath,
      worktreeHead: result.setup.worktreeHead,
      cleanupWorktree: result.setup.cleanupResult.worktree,
      cleanupTempRef: result.setup.cleanupResult.tempRef,
      now: input.now,
    });

    return { ok: true, validationWorkspace: result.setup };
  }

  const recovery = validationRuns.recordToolingFailure({
    runId: input.runId,
    operationName: result.toolingError.operationName,
    tempRefName: result.toolingError.tempRefName,
    submittedSha: result.toolingError.submittedSha,
    ...(result.toolingError.worktreePath === undefined
      ? {}
      : { worktreePath: result.toolingError.worktreePath }),
    errorMessage: result.toolingError.errorMessage,
    cleanupWorktree: result.toolingError.cleanupResult.worktree,
    cleanupTempRef: result.toolingError.cleanupResult.tempRef,
    taskRecoveryState: input.taskRecoveryState,
    now: input.now,
  });

  if (!recovery.ok) {
    throw new Error(`Could not recover Task after validation tooling failure: ${recovery.code}`);
  }

  return { ok: false, toolingError: result.toolingError };
};

export type { SubmitTaskResult };
