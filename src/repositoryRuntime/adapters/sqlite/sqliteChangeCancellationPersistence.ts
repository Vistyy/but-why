import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { changeState } from "../../../change/change.js";
import { internalChangeId } from "../../../change/changeId.js";
import type { ChangeCancellationRecord } from "../../../change/changePorts.js";
import type { CancelChangeInput } from "../../../change/changeStore.js";
import { validateChangePublicationRelationships } from "./sqliteChangeReadModel.js";
import { decodeChangeLifecycle, decodeStoredNullableString } from "./sqliteChangeValueDecoders.js";
import { readChangeLifecycle } from "./sqliteCompleteMergedChangeStorage.js";
import { decodePersisted } from "./sqlitePersistedData.js";
import {
  decodeTerminalChange,
  type StoredTerminalChangeRow,
  terminalChangeSelectionColumns,
} from "./sqliteTerminalChangeStorage.js";

const decodeCancellationChange = (
  row: StoredCancellationChangeRow,
  changeId: string,
  idPrefix: string,
): ChangeCancellationRecord => {
  const terminal = decodeTerminalChange(row, changeId, idPrefix);
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
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCancellationChangeRow>(
      `SELECT ${terminalChangeSelectionColumns},
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE id = ?`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () =>
      decodeCancellationChange(row, changeId, idPrefix),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
      idPrefix,
    );
    return selected;
  });

export const cancelChange = (
  sql: SqlClient.SqlClient,
  input: CancelChangeInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "cancel Change", idPrefix);
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      return { ok: true as const, changed: false };
    }
    yield* sql`UPDATE changes
      SET close_reason = 'cancelled', cancel_reason = ${input.reason},
          cleanup_pending = 1, cleanup_blocking_reason = NULL
      WHERE id = ${internalChangeId(input.changeId, idPrefix)} AND close_reason IS NULL`;
    return { ok: true as const, changed: true };
  });

type StoredCancellationChangeRow = StoredTerminalChangeRow & {
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
};
