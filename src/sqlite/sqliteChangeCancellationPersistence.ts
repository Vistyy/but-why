import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { changeState } from "../change/change.js";
import type {
  ChangeCancellationOwnerPort,
  ChangeCancellationRecord,
} from "../change/changePorts.js";
import type { CancelChangeInput } from "../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { changeIdSqlParameter, RepositorySql } from "./repositorySql.js";
import { validateChangePublicationRelationships } from "./sqliteChangeReadModel.js";
import { decodeChangeLifecycle, decodeStoredNullableString } from "./sqliteChangeValueDecoders.js";
import {
  completeMergedChange as completeChangeOnly,
  readChangeLifecycle,
} from "./sqliteCompleteMergedChangeStorage.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  decodeTerminalChange,
  type StoredTerminalChangeRow,
  terminalChangeSelectionColumns,
} from "./sqliteTerminalChangeStorage.js";

export const openSqliteChangeCancellationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeCancellationOwnerPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for cancellation", (sql) =>
          readCancellationChange(sql, changeId, "read Change for cancellation"),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeChangeOnly(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            return { ...result, change };
          }),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* cancelChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            return { ...result, change };
          }),
        ),
    }),
  );

const decodeCancellationChange = (
  row: StoredCancellationChangeRow,
  changeId: string,
): ChangeCancellationRecord => {
  const terminal = decodeTerminalChange(row, changeId);
  const lifecycle = decodeChangeLifecycle(row);
  const cancelReason = decodeStoredNullableString(row.cancelReason, "Change cancellation reason");
  if (cancelReason !== null && lifecycle.closeReason !== "cancelled") {
    throw new Error("Change cancellation relationship is invalid");
  }
  return {
    ...terminal,
    closeReason: lifecycle.closeReason,
    cancelReason,
  };
};

export const readCancellationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCancellationChangeRow>(
      `SELECT ${terminalChangeSelectionColumns},
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE id = ?`,
      [changeIdSqlParameter(changeId)],
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

export const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "cancel Change");
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      return { ok: true as const, changed: false };
    }
    yield* sql`UPDATE changes
      SET state = 'closed', close_reason = 'cancelled', cancel_reason = ${input.reason},
          cleanup_state = 'pending', cleanup_blocking_reason = NULL,
          updated_at = ${input.now}, closed_at = ${input.now}
      WHERE id = ${changeIdSqlParameter(input.changeId)} AND state = 'open'`;
    return { ok: true as const, changed: true };
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type StoredCancellationChangeRow = StoredTerminalChangeRow & {
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
};
