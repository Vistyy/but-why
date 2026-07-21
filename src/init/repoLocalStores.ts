import type { CandidateStore } from "../candidate/candidateStore.js";
import type { CandidateValidationRunStore } from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangeStore } from "../change/changeStore.js";
import type { ChangeStartStore } from "../change/changeStartStore.js";
import { openSqliteCandidateStore } from "../sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../sqlite/sqliteCandidateValidationRunStore.js";
import { openSqliteChangeStore } from "../sqlite/sqliteChangeStore.js";
import { openSqliteChangeStartStore } from "../sqlite/sqliteChangeStartStore.js";
import { openSqliteTaskStore } from "../sqlite/sqliteTaskStore.js";
import type { TaskStore } from "../task/taskStore.js";
import type { RepoLocalContext } from "./repoContext.js";

export type RepoLocalStores = {
  readonly candidateStore: CandidateStore;
  readonly candidateValidationRunStore: CandidateValidationRunStore;
  readonly changeStore: ChangeStore;
  readonly changeStartStore: ChangeStartStore;
  readonly taskStore: TaskStore;
};

export const openRepoLocalStores = (context: RepoLocalContext): RepoLocalStores => {
  const sqliteInput = context.stateDatabase;

  return {
    candidateStore: openSqliteCandidateStore(sqliteInput),
    candidateValidationRunStore: openSqliteCandidateValidationRunStore(sqliteInput),
    changeStore: openSqliteChangeStore(sqliteInput),
    changeStartStore: openSqliteChangeStartStore(sqliteInput),
    taskStore: openSqliteTaskStore({
      ...sqliteInput,
      taskPrefix: context.taskPrefix,
    }),
  };
};
