import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangeRecord, ChangeState } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { ChangeListRecord, ChangeReadPort } from "../change/changePorts.js";
import type { ListChangesInput } from "../change/changeStore.js";
import { deriveAcceptanceContext } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeImplementationDecisions,
  readImplementationBlockerHistory,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import {
  changeReadColumns,
  decodeChangeRow,
  type StoredChangeRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReadPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change", (sql) => getById(sql, changeId, repository.idPrefix)),
      listChanges: (input) =>
        input.repositoryCommonDirectory !== repository.commonDirectory
          ? Effect.succeed([])
          : repository.transaction("list Changes", (sql) =>
              listChanges(sql, input, repository.idPrefix),
            ),
    }),
  );
const getById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      internalChangeId(changeId, idPrefix),
    ]),
    (rows) => mapRow(rows[0], "read Change", sql, idPrefix),
  );
const listDecisions = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${internalChangeId(changeId, idPrefix)}
      ORDER BY id
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId, idPrefix),
      ),
  );
const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput, idPrefix: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeListRow>(
      `SELECT id,
        CASE WHEN close_reason IS NULL THEN 'open' ELSE 'closed' END AS state,
        branch_ref AS branchRef, worktree_path AS worktreePath
       FROM changes
       ${input.includeClosed ? "" : "WHERE close_reason IS NULL"}
       ORDER BY id`,
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) =>
          decodePersisted("list Changes", () => decodeChangeListRecord(row, idPrefix)),
        ),
        (changes) => changes,
      ),
  );
const decodeChangeListRecord = (row: StoredChangeListRow, idPrefix: string): ChangeListRecord => ({
  id: publicChangeId(idPrefix, row.id),
  state: row.state,
  branchRef: row.branchRef,
  worktreePath: row.worktreePath,
});
const mapRow = (
  row: StoredChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
  idPrefix: string,
) =>
  Effect.flatMap(
    mapChangeWithoutHistoryRow(row, operationName, sql, idPrefix),
    (changeWithoutHistory) =>
      changeWithoutHistory === undefined
        ? Effect.succeed(undefined)
        : Effect.gen(function* () {
            const decisions = yield* listDecisions(sql, changeWithoutHistory.id, idPrefix);
            const blockerHistory = yield* readImplementationBlockerHistory(
              sql,
              changeWithoutHistory.id,
              operationName,
              idPrefix,
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
  idPrefix: string,
) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const change = yield* decodePersisted(operationName, () => decodeChangeRow(row, idPrefix));
        yield* validateChangePublicationRelationships(
          sql,
          change.id,
          change.publication,
          operationName,
          idPrefix,
        );
        return change;
      });

type StoredChangeListRow = {
  readonly id: number;
  readonly state: ChangeState;
  readonly branchRef: string;
  readonly worktreePath: string;
};
