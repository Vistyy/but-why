import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeReconciliationPort } from "../change/changePorts.js";
import { RepositorySql } from "./repositorySql.js";
import { validateChangePublicationRelationships } from "./sqliteChangeReadModel.js";
import { decodeStoredString } from "./sqliteChangeValueDecoders.js";
import { completeMergedChange as completeChangeOnly } from "./sqliteCompleteMergedChangeStorage.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
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
          readTerminalChange(sql, changeId, "read Change for reconciliation"),
        ),
      listChangesForReconciliation: (commonDirectory) =>
        repository.transaction("list Changes for reconciliation", (sql) =>
          listReconciliationChanges(sql, commonDirectory),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeChangeOnly(sql, input);
            if (!result.ok) return result;
            const change = yield* requireTerminalChange(
              sql,
              input.changeId,
              "complete merged Change",
            );
            return { ...result, change };
          }),
        ),
    }),
  );
const listReconciliationChanges = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.gen(function* () {
    const operationName = "list Changes for reconciliation";
    const rows = yield* sql.unsafe<StoredTerminalChangeRow & { readonly createdAt: string }>(
      `SELECT ${terminalChangeSelectionColumns}, created_at AS createdAt FROM changes
       WHERE repository_common_directory = ?
         AND ((state = 'open' AND publication_pr_number IS NOT NULL)
           OR (state = 'closed' AND cleanup_state = 'pending'))`,
      [commonDirectory],
    );
    const selected = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const changeId = decodeStoredString(row.id, "Change id");
        const change = yield* decodePersisted(operationName, () =>
          decodeTerminalChange(row, changeId),
        );
        yield* validateChangePublicationRelationships(
          sql,
          change.id,
          change.publication,
          operationName,
        );
        const createdAt = decodeStoredString(row.createdAt, "Change creation time");
        return { change, createdAt };
      }),
    );
    return selected
      .sort(
        (left, right) =>
          compareStoredStrings(left.createdAt, right.createdAt) ||
          compareStoredStrings(left.change.id, right.change.id),
      )
      .map(({ change }) => change);
  });
const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
