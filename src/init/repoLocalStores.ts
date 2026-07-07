import type { RunStore } from "../run/runStore.js";
import { openSqliteRunStore } from "../sqlite/sqliteRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../sqlite/sqliteValidationRuns.js";
import type { TaskStore } from "../task/taskStore.js";
import type { ValidationRuns } from "../validation/validationRuns.js";
import type { ValidationWorkspaceSetup } from "../validation/validationWorkspace.js";
import type { RepoLocalContext } from "./repoContext.js";

export type RepoLocalStores = {
  readonly taskStore: TaskStore;
  readonly runStore: RunStore;
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

  const runStore = openSqliteRunStore(sqliteInput);

  return {
    taskStore: openSqliteTaskStore({
      ...sqliteInput,
      taskPrefix: context.taskPrefix,
    }),
    runStore,
    validationRuns: openSqliteValidationRuns(sqliteInput),
    recordValidationWorkspaceSetup: (now, setup) =>
      recordValidationWorkspaceSetup(runStore, now, setup),
  };
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
