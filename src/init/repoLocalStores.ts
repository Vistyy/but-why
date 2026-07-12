import type { CandidateStore } from "../candidate/candidateStore.js";
import type { ChangeCandidateCaptureStore } from "../changeCandidateCapture/changeCandidateCaptureStore.js";
import type { ChangeStore } from "../change/changeStore.js";
import { openSqliteCandidateStore } from "../sqlite/sqliteCandidateStore.js";
import { openSqliteChangeCandidateCaptureStore } from "../sqlite/sqliteChangeCandidateCaptureStore.js";
import { openSqliteChangeStore } from "../sqlite/sqliteChangeStore.js";
import type { ValidationRunStore } from "../validationRun/validationRunStore.js";
import { openSqliteValidationRunStore } from "../sqlite/sqliteValidationRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../sqlite/sqliteValidationRuns.js";
import type { TaskStore } from "../task/taskStore.js";
import type { ValidationRuns } from "../validation/validationRuns.js";
import type { ValidationWorkspaceSetup } from "../validation/validationWorkspace.js";
import type { RepoLocalContext } from "./repoContext.js";

export type ChangeCandidateCaptureStores = {
  readonly captureStore: ChangeCandidateCaptureStore;
  readonly changeStore: ChangeStore;
};

export type RepoLocalStores = {
  readonly candidateStore: CandidateStore;
  readonly changeStore: ChangeStore;
  readonly taskStore: TaskStore;
  readonly validationRunStore: ValidationRunStore;
  readonly validationRuns: ValidationRuns;
  readonly recordValidationWorkspaceSetup: (now: string, setup: ValidationWorkspaceSetup) => void;
};

export const openChangeCandidateCaptureStores = (input: {
  readonly statePath: string;
  readonly migrationTimestamp: () => string;
}): ChangeCandidateCaptureStores => ({
  captureStore: openSqliteChangeCandidateCaptureStore(input),
  changeStore: openSqliteChangeStore(input),
});

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
    candidateStore: openSqliteCandidateStore(sqliteInput),
    changeStore: openSqliteChangeStore(sqliteInput),
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
    worktreeHead: setup.worktreeHead,
    cleanupWorktree: setup.cleanupResult.worktree,
    cleanupTempRef: setup.cleanupResult.tempRef,
    now,
  });
};
