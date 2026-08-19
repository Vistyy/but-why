import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type { CancelChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  cancelChange as cancelChangeOnly,
  readCancellationChange,
} from "../../../sqlite/sqliteChangeCancellationPersistence.js";
import { cancelTaskState, getTaskById } from "../../../sqlite/sqliteTaskPersistence.js";
import { internalTaskId, publicTaskId, publicTaskIdFromInternal } from "../../../task/taskId.js";
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
          readTaskChangeCancellation(
            sql,
            changeId,
            "read Change for cancellation",
            repository.idPrefix,
          ),
        ),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task for cancellation", (sql) =>
          readTaskChangeCancellationByTaskId(sql, taskId, repository.idPrefix),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeLinkedChange(sql, input, repository.idPrefix);
            if (!result.ok) return result;
            const change = yield* requireTaskChangeCancellation(
              sql,
              input.changeId,
              repository.idPrefix,
            );
            const task = yield* readTaskForCancellation(sql, change.taskId, repository.idPrefix);
            return { ...result, change, task };
          }),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) =>
          cancelChange(sql, input, repository.idPrefix),
        ),
    }),
  );

const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput, idPrefix: string) =>
  Effect.gen(function* () {
    const current = yield* readTaskChangeCancellation(
      sql,
      input.changeId,
      "read Change for cancellation",
      idPrefix,
    );
    if (current?.state === "closed") {
      if (current.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      const task = yield* readTaskForCancellation(sql, current.taskId, idPrefix);
      return { ok: true as const, changed: false, change: current, task };
    }

    const link = yield* linkedTask(sql, input.changeId, idPrefix);
    if (link !== undefined) {
      const task = yield* getTaskById(
        sql,
        publicTaskIdFromInternal(link.taskId, idPrefix),
        idPrefix,
      );
      if (task === undefined) {
        return yield* invalidData("cancel Change", "Linked Task was not found");
      }
      if (!canCancelLinkedTask(task.state)) {
        return { ok: false as const, code: "change_already_completed" as const };
      }
    }

    const result = yield* cancelChangeOnly(sql, input, idPrefix);
    if (!result.ok) return result;
    if (result.changed && link !== undefined) {
      yield* cancelTaskState(
        sql,
        publicTaskIdFromInternal(link.taskId, idPrefix),
        input.reason,
        input.now,
        idPrefix,
      );
    }
    const change = yield* requireTaskChangeCancellation(sql, input.changeId, idPrefix);
    const task = yield* readTaskForCancellation(sql, change.taskId, idPrefix);
    return { ...result, change, task };
  });

const readTaskChangeCancellation = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* readCancellationChange(sql, changeId, operationName, idPrefix);
    if (change === undefined) return undefined;
    const link = yield* linkedTask(sql, changeId, idPrefix);
    return {
      ...change,
      taskId: link === undefined ? null : publicTaskIdFromInternal(link.taskId, idPrefix),
    } satisfies TaskChangeCancellationChange;
  });

const readTaskChangeCancellationByTaskId = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const link = yield* sql<{ readonly changeId: number }>`
      SELECT change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${internalTaskId(taskId, idPrefix)}
    `;
    const changeId = link[0]?.changeId;
    return changeId === undefined
      ? undefined
      : yield* readTaskChangeCancellation(
          sql,
          publicChangeId(idPrefix, changeId),
          "read Change by Task for cancellation",
          idPrefix,
        );
  });

const requireTaskChangeCancellation = (
  sql: SqlClient.SqlClient,
  changeId: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    readTaskChangeCancellation(sql, changeId, "read committed cancellation", idPrefix),
    (change) =>
      change === undefined
        ? invalidData("read committed cancellation", "Change disappeared")
        : Effect.succeed(change),
  );

const readTaskForCancellation = (
  sql: SqlClient.SqlClient,
  taskId: string | null,
  idPrefix: string,
) =>
  taskId === null
    ? Effect.succeed(null)
    : Effect.flatMap(getTaskById(sql, publicTaskId(taskId), idPrefix), (task) =>
        task === undefined
          ? invalidData("read committed cancellation", "Linked Task was not found")
          : Effect.succeed(task),
      );

const linkedTask = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: number }>`
      SELECT task_id AS taskId FROM task_change_links WHERE change_id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) => Effect.succeed(rows[0]),
  );

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
