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
import type { CreateValidationWorkspaceForRunResult } from "../submissionEnvironment/submissionEnvironment.js";
import { localSubmissionEnvironment } from "../submissionEnvironment/localSubmissionEnvironment.js";
import type {
  TaskAuthority,
  TaskAuthorityTaskIdResolution,
} from "../taskAuthority/taskAuthority.js";
import { localTaskAuthority } from "../taskAuthority/localTaskAuthority.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { SubmissionEnvironment } from "../submissionEnvironment/submissionEnvironment.js";
import type { ValidationWorkspaceSetup } from "../validation/createValidationWorkspace.js";

export type LocalSubmitPreflight = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => TaskAuthorityTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
  readonly createValidationWorkspaceForRun: (
    input: CreateLocalValidationWorkspaceForRunInput,
  ) => Promise<CreateValidationWorkspaceForRunResult>;
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
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type CreateLocalValidationWorkspaceForRunInput = {
  readonly runId: string;
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
    submit: localSubmitPreflight(repoContext.context, input.migrationTimestamp),
  };
};

const localSubmitPreflight = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): LocalSubmitPreflight => {
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
  const taskAuthority = localTaskAuthority({ context, taskStore, validationRuns });
  const submissionEnvironment = localSubmissionEnvironment({ context });
  const submitPreflight = openSubmitPreflight({ taskAuthority, submissionEnvironment });

  return {
    taskPrefix: taskAuthority.taskPrefix,
    resolveTaskId: taskAuthority.resolveTaskId,
    submitTask: submitPreflight.submitTask,
    createValidationWorkspaceForRun: (input) =>
      createValidationWorkspaceForRun(taskAuthority, submissionEnvironment, runStore, input),
  };
};

const createValidationWorkspaceForRun = async (
  taskAuthority: TaskAuthority,
  submissionEnvironment: SubmissionEnvironment,
  runStore: RunStore,
  input: CreateLocalValidationWorkspaceForRunInput,
): Promise<CreateValidationWorkspaceForRunResult> => {
  const result = await submissionEnvironment.createValidationWorkspaceForRun({
    runId: input.runId,
    commitSha: input.commitSha,
    now: input.now,
  });

  if (result.ok) {
    recordValidationWorkspaceSetup(runStore, input.now, result.validationWorkspace);

    return result;
  }

  const recovery = taskAuthority.recordValidationToolingFailure({
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

  return result;
};

const recordValidationWorkspaceSetup = (
  runStore: RunStore,
  now: string,
  setup: ValidationWorkspaceSetup,
): void => {
  runStore.recordValidationWorkspaceSetup({
    runId: setup.runId,
    tempRefName: setup.tempRefName,
    submittedSha: setup.submittedSha,
    worktreePath: setup.worktreePath,
    worktreeHead: setup.worktreeHead,
    cleanupWorktree: setup.cleanupResult.worktree,
    cleanupTempRef: setup.cleanupResult.tempRef,
    now,
  });
};

export type { SubmitTaskResult };
