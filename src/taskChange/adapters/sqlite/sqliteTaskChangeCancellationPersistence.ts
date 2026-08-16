import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeCancellationPort } from "../../../change/changePorts.js";
import type { CancelChangeInput, CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import {
  cancelChange as cancelChangeOnly,
  readCancellationChange,
  readCancellationChangeByTaskId,
  requireCancellationChange,
} from "../../../sqlite/sqliteChangeCancellationPersistence.js";
import { cancelTaskState, getTaskById } from "../../../sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../../../task/taskId.js";
import { canCancelLinkedTask } from "../../taskChange.js";
import { completeLinkedChange } from "./sqliteTaskChangePersistence.js";

export const openSqliteTaskChangeCancellationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeCancellationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for cancellation", (sql) =>
          readCancellationChange(sql, changeId, "read Change for cancellation"),
        ),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task for cancellation", (sql) =>
          readCancellationChangeByTaskId(sql, taskId),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          completeMergedChange(sql, input),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) => cancelChange(sql, input)),
    }),
  );

const completeMergedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const result = yield* completeLinkedChange(sql, input);
    if (!result.ok) return result;
    const change = yield* requireCancellationChange(sql, input.changeId);
    const task = yield* readTaskForCancellation(sql, change.taskId);
    return { ...result, change, task };
  });

const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const current = yield* readCancellationChange(sql, input.changeId, "cancel Change");
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
    const change = yield* requireCancellationChange(sql, input.changeId);
    const task = yield* readTaskForCancellation(sql, change.taskId);
    return { ...result, change, task };
  });

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
