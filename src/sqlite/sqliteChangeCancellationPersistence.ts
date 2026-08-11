import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { changeState } from "../change/change.js";
import type { CancellationChange, ChangeCancellationPort } from "../change/changePorts.js";
import type { CancelChangeInput } from "../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskDependencyFact } from "../task/task.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import { completeMergedChange, readChangeLifecycle } from "./sqliteCompleteMergedChangeStorage.js";
import { validateChangePublicationRelationships } from "./sqliteChangeReadModel.js";
import {
  decodeChangeLifecycle,
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import {
  decodeTerminalChange,
  type StoredTerminalChangeRow,
  terminalChangeSelectionColumns,
} from "./sqliteTerminalChangeStorage.js";
import {
  type DecodedStoredTaskRecordRow,
  decodePersisted,
  decodeStoredTaskRecordRow,
  decodeTaskDependencyFacts,
  type StoredTaskDependencyFactRow,
  type StoredTaskRecordRow,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeCancellationPort = () =>
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
          Effect.gen(function* () {
            const result = yield* completeMergedChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            const task = yield* readRequiredCancellationTask(sql, change);
            return { ...result, change, task };
          }),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* cancelChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            const task = yield* readRequiredCancellationTask(sql, change);
            return { ...result, change, task };
          }),
        ),
    }),
  );
const decodeCancellationChange = (
  row: StoredCancellationChangeRow,
  changeId: string,
): CancellationChange => {
  const terminal = decodeTerminalChange(row, changeId);
  const lifecycle = decodeChangeLifecycle(row);
  const taskId = decodeStoredNullableString(row.taskId, "Change Task id");
  const cancelReason = decodeStoredNullableString(row.cancelReason, "Change cancellation reason");
  if (cancelReason !== null && lifecycle.closeReason !== "cancelled") {
    throw new Error("Change cancellation relationship is invalid");
  }
  return {
    ...terminal,
    taskId: taskId === null ? null : storedPublicTaskId(taskId),
    closeReason: lifecycle.closeReason,
    cancelReason,
  };
};
const readCancellationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCancellationChangeRow>(
      `SELECT ${terminalChangeSelectionColumns}, task_id AS taskId,
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () =>
      decodeCancellationChange(row, changeId),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const requireCancellationChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(readCancellationChange(sql, changeId, "read committed cancellation"), (change) =>
    change === undefined
      ? invalidData("read committed cancellation", "Change disappeared")
      : Effect.succeed(change),
  );
const readRequiredCancellationTask = (sql: SqlClient.SqlClient, change: CancellationChange) =>
  change.taskId === null
    ? Effect.succeed(null)
    : Effect.flatMap(readCancellationTask(sql, change.taskId), (task) =>
        task === undefined
          ? invalidData("read committed cancellation", "Linked Task was not found")
          : Effect.succeed(task),
      );
const readCancellationTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const operationName = "read committed cancellation";
    const rows = yield* sql<StoredTaskRecordRow>`
      SELECT id, numeric_id AS numericId, title, description, state,
        cancel_reason AS cancelReason, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted(operationName, () => decodeStoredTaskRecordRow(row));
    const prerequisites = yield* cancellationTaskDependencyFacts(
      sql,
      taskId,
      "prerequisites",
      operationName,
    );
    const dependents = yield* cancellationTaskDependencyFacts(
      sql,
      taskId,
      "dependents",
      operationName,
    );
    return cancellationTaskRecord(decoded, prerequisites, dependents);
  });
const cancellationTaskDependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  direction: "prerequisites" | "dependents",
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows =
      direction === "prerequisites"
        ? yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
            WHERE task_dependencies.dependent_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `
        : yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
            WHERE task_dependencies.prerequisite_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `;
    return yield* decodePersisted(operationName, () => decodeTaskDependencyFacts(rows, taskId));
  });
const cancellationTaskRecord = (
  row: DecodedStoredTaskRecordRow,
  prerequisites: readonly TaskDependencyFact[],
  dependents: readonly TaskDependencyFact[],
) => {
  const { numericId: _numericId, ...summary } = row;
  const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
  return {
    ...summary,
    startable: row.state === "todo" && blockedBy.length === 0,
    blockedBy,
    description: row.description,
    cancelReason: row.cancelReason,
    prerequisites,
    dependents,
  };
};
const readCancellationChangeByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const operationName = "read Change by Task for cancellation";
    const rows = yield* sql.unsafe<StoredCancellationChangeRow>(
      `SELECT ${terminalChangeSelectionColumns}, task_id AS taskId,
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE task_id = ?`,
      [taskId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const changeId = decodeStoredString(row.id, "Change id");
    const selected = yield* decodePersisted(operationName, () =>
      decodeCancellationChange(row, changeId),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const readCancelChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "cancel Change";
    const rows = yield* sql<StoredChangeLifecycleRow & { readonly taskId: unknown }>`
      SELECT id, state, close_reason AS closeReason, task_id AS taskId
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => ({
      ...decodeSelectedChangeLifecycle(row, changeId),
      taskId: decodeStoredNullableString(row.taskId, "Change Task id"),
    }));
  });
const decodeSelectedChangeState = (row: StoredChangeStateRow, changeId: string) => {
  const id = decodeStoredString(row.id, "Change id");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row.state) };
};
const decodeSelectedChangeLifecycle = (row: StoredChangeLifecycleRow, changeId: string) => ({
  id: decodeSelectedChangeState(row, changeId).id,
  ...decodeChangeLifecycle(row),
});
const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "cancel Change");
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      return { ok: true as const, changed: false };
    }
    const change = yield* readCancelChange(sql, input.changeId);
    if (change === undefined) return yield* invalidData("cancel Change", "Change disappeared");
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'cancelled', cancel_reason = ${change.taskId === null ? input.reason : null}, cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}, updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return { ok: true as const, changed: true };
  });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
type StoredChangeStateRow = {
  readonly id: unknown;
  readonly state: unknown;
};
type StoredChangeLifecycleRow = StoredChangeStateRow & {
  readonly closeReason: unknown;
};
type StoredCancellationChangeRow = StoredTerminalChangeRow & {
  readonly taskId: unknown;
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
};
