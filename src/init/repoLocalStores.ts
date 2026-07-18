import type { CandidateStore } from "../candidate/candidateStore.js";
import type { CandidateValidationRunStore } from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangeCandidateCaptureStore } from "../changeCandidateCapture/changeCandidateCaptureStore.js";
import type { ChangeStore } from "../change/changeStore.js";
import { openSqliteCandidateStore } from "../sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../sqlite/sqliteCandidateValidationRunStore.js";
import {
  openSqliteChangeCandidateCaptureStore,
  validateChangeCandidateCaptureState,
} from "../sqlite/sqliteChangeCandidateCaptureStore.js";
import { openSqliteChangeStore } from "../sqlite/sqliteChangeStore.js";
import type { ValidationRunStore } from "../validationRun/validationRunStore.js";
import { openSqliteValidationRunStore } from "../sqlite/sqliteValidationRunStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import { openSqliteTaskStartStore } from "../sqlite/sqliteTaskStartStore.js";
import { openSqliteValidationRuns } from "../sqlite/sqliteValidationRuns.js";
import type { TaskStore } from "../task/taskStore.js";
import type { TaskStartStore } from "../taskStart/taskStartStore.js";
import type { ValidationRuns } from "../validation/validationRuns.js";
import type { ValidationWorkspaceSetup } from "../validation/validationWorkspace.js";
import type { RepoLocalContext } from "./repoContext.js";

export type ChangeCandidateCaptureStores = {
  readonly captureStore: ChangeCandidateCaptureStore;
  readonly changeStore: ChangeStore;
};

export type OpenChangeCandidateCaptureStoresResult =
  | { readonly ok: true; readonly stores: ChangeCandidateCaptureStores }
  | { readonly ok: false; readonly code: "shared_state_identity_conflict" };

export type RepoLocalStores = {
  readonly candidateStore: CandidateStore;
  readonly candidateValidationRunStore: CandidateValidationRunStore;
  readonly changeStore: ChangeStore;
  readonly taskStore: TaskStore;
  readonly taskStartStore: TaskStartStore;
  readonly validationRunStore: ValidationRunStore;
  readonly validationRuns: ValidationRuns;
  readonly recordValidationWorkspaceSetup: (now: string, setup: ValidationWorkspaceSetup) => void;
};

export const openChangeCandidateCaptureStores = (input: {
  readonly statePath: string;
  readonly migrationTimestamp: () => string;
  readonly commonDirectory: string;
}): OpenChangeCandidateCaptureStoresResult => {
  const stateValidation = validateChangeCandidateCaptureState(input);
  if (!stateValidation.ok) return stateValidation;

  return {
    ok: true,
    stores: {
      captureStore: openSqliteChangeCandidateCaptureStore(stateValidation.session),
      changeStore: openSqliteChangeStore(stateValidation.session),
    },
  };
};

export const openRepoLocalStores = (context: RepoLocalContext): RepoLocalStores => {
  const sqliteInput = context.stateDatabase;

  const validationRunStore = openSqliteValidationRunStore(sqliteInput);

  return {
    candidateStore: openSqliteCandidateStore(sqliteInput),
    candidateValidationRunStore: openSqliteCandidateValidationRunStore(sqliteInput),
    changeStore: openSqliteChangeStore(sqliteInput),
    taskStore: openSqliteTaskStore({
      ...sqliteInput,
      taskPrefix: context.taskPrefix,
    }),
    taskStartStore: openSqliteTaskStartStore(sqliteInput),
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
