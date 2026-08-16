import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import { completeMergedChange as completeChangeOnly } from "../../../sqlite/sqliteCompleteMergedChangeStorage.js";
import { completeTask, getTaskById } from "../../../sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../../../task/taskId.js";
import { decideTaskCompletion, type TaskCompletionDecision } from "../../taskChange.js";
import type { TaskChangeLinkPort } from "../../taskChangePorts.js";

export const openSqliteTaskChangeLinkPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeLinkPort => ({
      getByTaskId: (taskId) =>
        repository.transaction("read Change link by Task", (sql) => readByTaskId(sql, taskId)),
      getByChangeId: (changeId) =>
        repository.transaction("read Task link by Change", (sql) => readByChangeId(sql, changeId)),
    }),
  );

export const completeLinkedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const link = yield* readByChangeId(sql, input.changeId);
    let taskDecision: TaskCompletionDecision | undefined;
    if (link !== undefined) {
      const task = yield* getTaskById(sql, storedPublicTaskId(link.taskId));
      if (task === undefined) {
        return yield* Effect.fail(
          new RepositoryPersistedDataInvalid({
            operationName: "complete linked Change",
            cause: new Error("Linked Task was not found"),
          }),
        );
      }
      taskDecision = yield* Effect.succeed(decideTaskCompletion(task.state));
      if (!taskDecision.ok) {
        return { ok: false as const, code: "task_completion_rejected" as const };
      }
    }

    const result = yield* completeChangeOnly(sql, input);
    if (!result.ok) return result;
    if (link !== undefined && taskDecision?.state === "todo") {
      yield* completeTask(sql, link.taskId, input.now);
    }
    return result;
  });

const readByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: string; readonly changeId: string }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${taskId}
    `,
    (rows) => Effect.succeed(rows[0]),
  );

const readByChangeId = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: string; readonly changeId: string }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE change_id = ${changeId}
    `,
    (rows) => Effect.succeed(rows[0]),
  );
