import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CancelChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import {
  cancelChange as cancelChangeOnly,
  readCancellationChange,
} from "../../../sqlite/sqliteChangeCancellationPersistence.js";
import { cancelTaskState, getTaskById } from "../../../sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../../../task/taskId.js";
import { canCancelLinkedTask } from "../../taskChange.js";
import type {
  TaskChangeCancellationChange,
  TaskChangeCancellationPort,
} from "../../taskChangePorts.js";
import { completeLinkedChange } from "./sqliteTaskChangePersistence.js";

export const openSqliteTaskChangeCancellationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeCancellationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for cancellation", (sql) =>
          readTaskChangeCancellation(sql, changeId, "read Change for cancellation"),
        ),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task for cancellation", (sql) =>
          readTaskChangeCancellationByTaskId(sql, taskId),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeLinkedChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireTaskChangeCancellation(sql, input.changeId);
            const task = yield* readTaskForCancellation(sql, change.taskId);
            return { ...result, change, task };
          }),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) => cancelChange(sql, input)),
    }),
  );

const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const current = yield* readTaskChangeCancellation(sql, input.changeId);
    if (current?.state === "closed") {
      if (current.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      const task = yield* readTaskForCancellation(sql, current.taskId);
      return { ok: true as const, changed: false, change: current, task };
    }

    const link = yield* linkedTask(sql, input.changeId);
    if (link !== undefined) {
      const task = yield* getTaskById(sql, storedPublicTaskId(link.taskId));
      if (task === undefined) {
        return yield* invalidData("cancel Change", "Linked Task was not found");
      }
      if (!canCancelLinkedTask(task.state)) {
        return { ok: false as const, code: "change_already_completed" as const };
      }
    }

    const result = yield* cancelChangeOnly(sql, input);
    if (!result.ok) return result;
    if (result.changed && link !== undefined) {
      yield* cancelTaskState(sql, link.taskId, input.reason, input.now);
    }
    const change = yield* requireTaskChangeCancellation(sql, input.changeId);
    const task = yield* readTaskForCancellation(sql, change.taskId);
    return { ...result, change, task };
  });

const readTaskChangeCancellation = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName = "read Change for cancellation",
) =>
  Effect.gen(function* () {
    const change = yield* readCancellationChange(sql, changeId, operationName);
    if (change === undefined) return undefined;
    const link = yield* linkedTask(sql, changeId);
    return {
      ...change,
      taskId: link === undefined ? null : storedPublicTaskId(link.taskId),
    } satisfies TaskChangeCancellationChange;
  });

const readTaskChangeCancellationByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const link = yield* sql<{ readonly changeId: string }>`
      SELECT change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${taskId}
    `;
    const changeId = link[0]?.changeId;
    return changeId === undefined
      ? undefined
      : yield* readTaskChangeCancellation(sql, changeId, "read Change by Task for cancellation");
  });

const requireTaskChangeCancellation = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    readTaskChangeCancellation(sql, changeId, "read committed cancellation"),
    (change) =>
      change === undefined
        ? invalidData("read committed cancellation", "Change disappeared")
        : Effect.succeed(change),
  );

const readTaskForCancellation = (sql: SqlClient.SqlClient, taskId: string | null) =>
  taskId === null
    ? Effect.succeed(null)
    : Effect.flatMap(getTaskById(sql, storedPublicTaskId(taskId)), (task) =>
        task === undefined
          ? invalidData("read committed cancellation", "Linked Task was not found")
          : Effect.succeed(task),
      );

const linkedTask = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: string }>`
      SELECT task_id AS taskId FROM task_change_links WHERE change_id = ${changeId}
    `,
    (rows) => Effect.succeed(rows[0]),
  );

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
