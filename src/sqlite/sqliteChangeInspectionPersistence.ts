import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangeRecord, changeState } from "../change/change.js";
import type {
  ChangeListRecord,
  ChangeReadPort,
  ChangeTaskProjectionRecord,
} from "../change/changePorts.js";
import type { ListChangesInput } from "../change/changeStore.js";
import { RepositorySql } from "./repositorySql.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeChangeState,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type UnknownChangeRow,
  type UnknownImplementationBlockerRow,
  type UnknownImplementationDecisionRow,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredString,
  decodeStoredTaskId,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReadPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change", (sql) => getById(sql, changeId)),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task", (sql) => getByTaskId(sql, taskId)),
      listChanges: (input) =>
        repository.transaction("list Changes", (sql) => listChanges(sql, input)),
    }),
  );
const readActiveBlocker = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND resolved_at IS NULL", [
      changeId,
    ]),
    (history) => history.active,
  );
const readSelectedBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  predicate: string,
  parameters: readonly unknown[],
) =>
  Effect.flatMap(
    sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );
const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );
const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );
const getByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const operationName = "read Change by Task";
    const rows = yield* sql.unsafe<Record<string, unknown>>(
      "SELECT id, state FROM changes WHERE task_id = ?",
      [taskId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => ({
      id: decodeStoredString(row["id"], "Change ID"),
      state: decodeChangeState(row["state"]),
    }));
    const activeBlocker =
      selected.state === changeState.closed
        ? null
        : yield* readActiveBlocker(sql, selected.id, operationName);
    return { ...selected, activeBlocker } satisfies ChangeTaskProjectionRecord;
  });
const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<Record<string, unknown>>(
      `SELECT id, task_id AS taskId, state, branch_ref AS branchRef,
        worktree_path AS worktreePath, created_at AS createdAt
       FROM changes
       WHERE repository_common_directory = ?${input.includeClosed ? "" : " AND state = 'open'"}`,
      [input.repositoryCommonDirectory],
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) =>
          decodePersisted("list Changes", () => decodeChangeListRecord(row)),
        ),
        (changes) => changes.sort(compareChanges),
      ),
  );
const decodeChangeListRecord = (row: Record<string, unknown>): ChangeListRecord => {
  const storedTaskId = decodeStoredNullableString(row["taskId"], "Change Task ID");
  return {
    id: decodeStoredString(row["id"], "Change ID"),
    taskId: storedTaskId === null ? null : decodeStoredTaskId(storedTaskId, "Change Task ID"),
    state: decodeChangeState(row["state"]),
    branchRef: decodeStoredString(row["branchRef"], "Change Repository Branch"),
    worktreePath: decodeStoredNullableString(row["worktreePath"], "Change Managed Worktree path"),
    createdAt: decodeStoredString(row["createdAt"], "Change creation time"),
  };
};
const compareChanges = (
  left: Pick<ChangeListRecord, "createdAt" | "id">,
  right: Pick<ChangeListRecord, "createdAt" | "id">,
): number =>
  compareStoredStrings(left.createdAt, right.createdAt) || compareStoredStrings(left.id, right.id);
const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
const mapRow = (
  row: UnknownChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapChangeWithoutHistoryRow(row, operationName, sql), (changeWithoutHistory) =>
    changeWithoutHistory === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const decisions = yield* listDecisions(sql, changeWithoutHistory.id);
          const activeBlocker = yield* readActiveBlocker(
            sql,
            changeWithoutHistory.id,
            operationName,
          );
          return {
            ...changeWithoutHistory,
            implementationDecisions: decisions,
            activeBlocker,
          } satisfies ChangeRecord;
        }),
  );
const mapChangeWithoutHistoryRow = (
  row: UnknownChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const change = yield* decodePersisted(operationName, () => decodeChangeRow(row));
        yield* validateChangeRelationships(sql, change, operationName);
        return change;
      });
