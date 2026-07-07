import type { ValidationRunStore } from "../validationRun/validationRunStore.js";
import { openSqliteValidationRunStore } from "../sqlite/sqliteValidationRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../sqlite/sqliteValidationRuns.js";
import type { TaskStore } from "../task/taskStore.js";
import type { ValidationRuns } from "../validation/validationRuns.js";
import type { ValidationWorkspaceSetup } from "../validation/validationWorkspace.js";
import type { RepoLocalContext } from "./repoContext.js";

export type RepoLocalStores = {
  readonly taskStore: TaskStore;
  readonly validationRunStore: ValidationRunStore;
  readonly validationRuns: ValidationRuns;
  readonly recordValidationWorkspaceSetup: (now: string, setup: ValidationWorkspaceSetup) => void;
};

export const openRepoLocalStores = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): RepoLocalStores => {
  const sqliteInput = {
    statePath: context.paths.statePath,
    migrationTimestamp,
  };

  const validationRunStore = openSqliteValidationRunStore(sqliteInput);

  return {
    taskStore: openSqliteTaskStore({
      ...sqliteInput,
      taskPrefix: context.taskPrefix,
    }),
    validationRunStore,
    validationRuns: openSqliteValidationRuns(sqliteInput),
    recordValidationWorkspaceSetup: (now, setup) =>
      recordValidationWorkspaceSetup(validationRunStore, now, setup),
  };
};

const recordValidationWorkspaceSetup = (
  validationRunStore: ValidationRunStore,
  now: string,
  setup: ValidationWorkspaceSetup,
): void => {
  validationRunStore.recordValidationWorkspaceSetup({
    validationRunId: setup.validationRunId,
    tempRefName: setup.tempRefName,
    submittedSha: setup.submittedSha,
    worktreePath: setup.worktreePath,
    worktreeHead: setup.worktreeHead,
    cleanupWorktree: setup.cleanupResult.worktree,
    cleanupTempRef: setup.cleanupResult.tempRef,
    now,
  });
};
