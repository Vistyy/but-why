import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangeRecord, type ChangeState, changeState } from "../change/change.js";
import type {
  ChangeListRecord,
  ChangeReadPort,
  ChangeTaskProjectionRecord,
} from "../change/changePorts.js";
import type { ListChangesInput } from "../change/changeStore.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  deriveAcceptanceContext,
  implementationBlockerReadColumns,
  readImplementationBlockerHistory,
  type StoredChangeRow,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

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
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );
const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );
const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
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
    const rows = yield* sql.unsafe<StoredTaskProjectionRow>(
      "SELECT id, state FROM changes WHERE task_id = ?",
      [taskId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = { id: row.id, state: row.state };
    const activeBlocker =
      selected.state === changeState.closed
        ? null
        : yield* readActiveBlocker(sql, selected.id, operationName);
    return { ...selected, activeBlocker } satisfies ChangeTaskProjectionRecord;
  });
const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeListRow>(
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
const decodeChangeListRecord = (row: StoredChangeListRow): ChangeListRecord => {
  if (row.taskId !== null) storedPublicTaskId(row.taskId);
  return {
    id: row.id,
    state: row.state,
    branchRef: row.branchRef,
    worktreePath: row.worktreePath,
    createdAt: row.createdAt,
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
  row: StoredChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapChangeWithoutHistoryRow(row, operationName, sql), (changeWithoutHistory) =>
    changeWithoutHistory === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const decisions = yield* listDecisions(sql, changeWithoutHistory.id);
          const blockerHistory = yield* readImplementationBlockerHistory(
            sql,
            changeWithoutHistory.id,
            operationName,
          );
          return {
            ...changeWithoutHistory,
            acceptanceContext: deriveAcceptanceContext(
              changeWithoutHistory.acceptanceContext,
              blockerHistory,
            ),
            implementationDecisions: decisions,
            activeBlocker: blockerHistory.active,
          } satisfies ChangeRecord;
        }),
  );
const mapChangeWithoutHistoryRow = (
  row: StoredChangeRow | undefined,
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

type StoredTaskProjectionRow = {
  readonly id: string;
  readonly state: ChangeState;
};
type StoredChangeListRow = {
  readonly id: string;
  readonly taskId: string | null;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
};
