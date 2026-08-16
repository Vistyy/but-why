import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import { changeExists } from "../../../sqlite/sqliteChangeInspectionPersistence.js";
import { completeMergedChange as completeChangeOnly } from "../../../sqlite/sqliteCompleteMergedChangeStorage.js";
import { completeTask, getTaskById, taskExists } from "../../../sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../../../task/taskId.js";
import { decideTaskCompletion, type TaskCompletionDecision } from "../../taskChange.js";
import type { TaskChangeLink, TaskChangeLinkMutationPort } from "../../taskChangePorts.js";

export const openSqliteTaskChangeLinkPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeLinkMutationPort => ({
      getByTaskId: (taskId) =>
        repository.transaction("read Change link by Task", (sql) => readByTaskId(sql, taskId)),
      getByChangeId: (changeId) =>
        repository.transaction("read Task link by Change", (sql) => readByChangeId(sql, changeId)),
      link: (input) =>
        repository.transactionImmediate("link Task and Change", (sql) => link(sql, input)),
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

const link = (sql: SqlClient.SqlClient, input: TaskChangeLink) =>
  Effect.gen(function* () {
    if (!(yield* taskExists(sql, input.taskId))) {
      return { ok: false as const, code: "task_not_found" as const };
    }
    if (!(yield* changeExists(sql, input.changeId))) {
      return { ok: false as const, code: "change_not_found" as const };
    }
    const conflicts = yield* sql<{ readonly taskId: string; readonly changeId: string }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${input.taskId} OR change_id = ${input.changeId}
    `;
    if (conflicts.length > 0) {
      const existing = conflicts[0];
      if (existing?.taskId === input.taskId && existing.changeId === input.changeId) {
        return { ok: true as const, link: input };
      }
      return { ok: false as const, code: "task_change_conflict" as const };
    }
    yield* sql`
      INSERT INTO task_change_links (task_id, change_id)
      VALUES (${input.taskId}, ${input.changeId})
    `;
    return { ok: true as const, link: input };
  });
