import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { publicChangeId } from "../../changeId.js";
import type { ChangeReconciliationPort } from "../../changePorts.js";
import { validateChangePublicationRelationships } from "./sqliteChangeReadModel.js";
import { completeMergedChange as completeChangeOnly } from "./sqliteCompleteMergedChangeStorage.js";
import {
  decodeTerminalChange,
  readTerminalChange,
  requireTerminalChange,
  type StoredTerminalChangeRow,
  terminalChangeSelectionColumns,
} from "./sqliteTerminalChangeStorage.js";

export const openSqliteChangeReconciliationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReconciliationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for reconciliation", (sql) =>
          readTerminalChange(sql, changeId, "read Change for reconciliation", repository.idPrefix),
        ),
      listChangesForReconciliation: (commonDirectory) =>
        repository.transaction("list Changes for reconciliation", (sql) =>
          listReconciliationChanges(sql, commonDirectory, repository.idPrefix),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeChangeOnly(sql, input, repository.idPrefix);
            if (!result.ok) return result;
            const change = yield* requireTerminalChange(
              sql,
              input.changeId,
              "complete merged Change",
              repository.idPrefix,
            );
            return { ...result, change };
          }),
        ),
    }),
  );

const listReconciliationChanges = (
  sql: SqlClient.SqlClient,
  commonDirectory: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "list Changes for reconciliation";
    const rows = yield* sql.unsafe<StoredTerminalChangeRow>(
      `SELECT ${terminalChangeSelectionColumns} FROM changes
       WHERE (SELECT common_directory FROM shared_state_identity WHERE id = 1) = ?
         AND ((close_reason IS NULL AND EXISTS (
                SELECT 1 FROM github_publications
                WHERE github_publications.change_id = changes.id
                  AND github_publications.pull_request_number IS NOT NULL
              ))
           OR (close_reason IS NOT NULL AND cleanup_pending = 1))
       ORDER BY changes.id`,
      [commonDirectory],
    );
    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const change = yield* decodePersisted(operationName, () =>
          decodeTerminalChange(row, publicChangeId(idPrefix, row.id), idPrefix),
        );
        yield* validateChangePublicationRelationships(
          sql,
          change.id,
          change.publication,
          operationName,
          idPrefix,
        );
        return change;
      }),
    );
  });
