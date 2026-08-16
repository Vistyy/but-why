import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeRecord, ChangeState } from "../change/change.js";
import type { ChangeListRecord, ChangeReadPort } from "../change/changePorts.js";
import type { ListChangesInput } from "../change/changeStore.js";
import { changeIdSqlParameter, RepositorySql } from "./repositorySql.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeImplementationDecisions,
  deriveAcceptanceContext,
  readImplementationBlockerHistory,
  type StoredChangeRow,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReadPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change", (sql) => getById(sql, changeId)),
      listChanges: (input) =>
        repository.transaction("list Changes", (sql) => listChanges(sql, input)),
    }),
  );
const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeIdSqlParameter(changeId),
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );
const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeIdSqlParameter(changeId)}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );
const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeListRow>(
      `SELECT id,
        state, branch_ref AS branchRef,
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
const decodeChangeListRecord = (row: StoredChangeListRow): ChangeListRecord => ({
  id: row.id,
  state: row.state,
  branchRef: row.branchRef,
  worktreePath: row.worktreePath,
  createdAt: row.createdAt,
});
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
        yield* validateChangePublicationRelationships(
          sql,
          change.id,
          change.publication,
          operationName,
        );
        return change;
      });

type StoredChangeListRow = {
  readonly id: string;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
};
