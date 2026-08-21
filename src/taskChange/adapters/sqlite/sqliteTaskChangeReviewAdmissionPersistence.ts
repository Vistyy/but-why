import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import type { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type {
  AdmitTaskReviewInput,
  AdmitTaskReviewResult,
  TaskReviewAdmissionPersistence,
  TaskReviewAdmissionRejection,
} from "../../../task/review/taskReviewPersistence.js";
import { readTaskChangeLinkByTaskId } from "./sqliteTaskChangePersistence.js";

export type TaskReviewSqlOperations = {
  readonly checkAdmission: (
    sql: SqlClient.SqlClient,
    taskId: string,
    idPrefix: string,
    linkedChangeId?: string,
  ) => Effect.Effect<
    TaskReviewAdmissionRejection | undefined,
    SqlError | RepositoryPersistedDataInvalid
  >;
  readonly admit: (
    sql: SqlClient.SqlClient,
    input: AdmitTaskReviewInput,
    idPrefix: string,
    repositoryCommonDirectory: string,
    linkedChangeId?: string,
  ) => Effect.Effect<AdmitTaskReviewResult, SqlError | RepositoryPersistedDataInvalid>;
};

export type TaskChangeReviewAdmissionPersistence = TaskReviewAdmissionPersistence;

export const openSqliteTaskChangeReviewAdmissionPersistence = (
  taskOperations: TaskReviewSqlOperations,
): Effect.Effect<TaskChangeReviewAdmissionPersistence, never, RepositorySql> =>
  Effect.map(RepositorySql, (repository) => ({
    checkAdmission: (taskId) =>
      repository.transaction("check Task Review admission", (sql) =>
        Effect.flatMap(readTaskChangeLinkByTaskId(sql, taskId, repository.idPrefix), (link) =>
          taskOperations.checkAdmission(sql, taskId, repository.idPrefix, link?.changeId),
        ),
      ),
    admit: (input: AdmitTaskReviewInput) =>
      repository.transactionImmediate("admit Task Review", (sql) =>
        Effect.flatMap(readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix), (link) =>
          taskOperations.admit(
            sql,
            input,
            repository.idPrefix,
            repository.commonDirectory,
            link?.changeId,
          ),
        ),
      ),
  }));
