import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { internalTaskId, publicTaskIdFromInternal } from "../../../task/taskId.js";
import type { StoredTaskRecord } from "../../../task/taskStore.js";
import { decideTaskCompletion, type TaskCompletionDecision } from "../../taskChange.js";
import type { TaskChangeLinkPort } from "../../taskChangePorts.js";

export type TaskReadOperation = {
  readonly getTaskById: (
    sql: SqlClient.SqlClient,
    taskId: PublicTaskId,
    idPrefix: string,
  ) => Effect.Effect<StoredTaskRecord | undefined, SqlError | RepositoryPersistedDataInvalid>;
};

export type TaskChangeCompletionOperations = {
  readonly completeChange: (
    sql: SqlClient.SqlClient,
    input: CompleteMergedChangeInput,
    idPrefix: string,
  ) => Effect.Effect<
    | { readonly ok: true; readonly changed: boolean }
    | {
        readonly ok: false;
        readonly code: "change_not_found" | "change_already_closed" | "publication_mismatch";
      },
    SqlError | RepositoryPersistedDataInvalid
  >;
  readonly getTaskById: TaskReadOperation["getTaskById"];
  readonly completeTask: (
    sql: SqlClient.SqlClient,
    taskId: string,
    now: string,
    idPrefix: string,
  ) => Effect.Effect<readonly unknown[], SqlError>;
};

export const openSqliteTaskChangeLinkPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeLinkPort => ({
      getByTaskId: (taskId) =>
        repository.transaction("read Change link by Task", (sql) =>
          readTaskChangeLinkByTaskId(sql, taskId, repository.idPrefix),
        ),
      getByChangeId: (changeId) =>
        repository.transaction("read Task link by Change", (sql) =>
          readTaskChangeLinkByChangeId(sql, changeId, repository.idPrefix),
        ),
    }),
  );

export const completeLinkedChange = (
  sql: SqlClient.SqlClient,
  input: CompleteMergedChangeInput,
  idPrefix: string,
  operations: TaskChangeCompletionOperations,
) =>
  Effect.gen(function* () {
    const link = yield* readTaskChangeLinkByChangeId(sql, input.changeId, idPrefix);
    let taskDecision: TaskCompletionDecision | undefined;
    if (link !== undefined) {
      const task = yield* operations.getTaskById(sql, link.taskId, idPrefix);
      if (task === undefined) {
        return yield* new RepositoryPersistedDataInvalid({
          operationName: "complete linked Change",
          cause: new Error("Linked Task was not found"),
        });
      }
      taskDecision = yield* Effect.succeed(decideTaskCompletion(task.state));
      if (!taskDecision.ok) {
        return { ok: false as const, code: "task_completion_rejected" as const };
      }
    }

    const result = yield* operations.completeChange(sql, input, idPrefix);
    if (!result.ok) return result;
    if (link !== undefined && taskDecision?.state === "todo") {
      yield* operations.completeTask(sql, link.taskId, input.now, idPrefix);
    }
    return result;
  });

export const readTaskChangeLinkByTaskId = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
) =>
  Effect.map(
    sql<{ readonly taskId: number; readonly changeId: number }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${internalTaskId(taskId, idPrefix)}
    `,
    (rows) =>
      rows[0] === undefined
        ? undefined
        : {
            taskId: publicTaskIdFromInternal(rows[0].taskId, idPrefix),
            changeId: publicChangeId(idPrefix, rows[0].changeId),
          },
  );

const readTaskChangeLinkByChangeId = (
  sql: SqlClient.SqlClient,
  changeId: string,
  idPrefix: string,
) =>
  Effect.map(
    sql<{ readonly taskId: number; readonly changeId: number }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE change_id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      rows[0] === undefined
        ? undefined
        : {
            taskId: publicTaskIdFromInternal(rows[0].taskId, idPrefix),
            changeId: publicChangeId(idPrefix, rows[0].changeId),
          },
  );
