import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { ChangeCleanup } from "../../change.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";
import type { TerminalChangeCleanupPort } from "../../changePorts.js";
import type { RecordChangeCleanupInput } from "../../changeStore.js";
import { decodeStoredNullableString } from "./sqliteChangeValueDecoders.js";

export const openSqliteTerminalChangeCleanupPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TerminalChangeCleanupPort => ({
      recordCleanup: (input) =>
        repository.transactionImmediate("record Change cleanup", (sql) =>
          recordCleanup(sql, input, repository.idPrefix),
        ),
    }),
  );

const readCleanupChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<StoredCleanupChangeRow>`
      SELECT id, close_reason AS closeReason, cleanup_pending AS cleanupPending,
        cleanup_blocking_reason AS cleanupBlockingReason
      FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      decodePersisted("record Change cleanup", () => {
        const row = rows[0];
        if (row === undefined) return undefined;
        const id = publicChangeId(idPrefix, row.id);
        if (id !== changeId) throw new Error("Change identity does not match lookup");
        return {
          id,
          state: row.closeReason === null ? ("open" as const) : ("closed" as const),
          cleanup: decodeCleanup(row.cleanupPending, row.cleanupBlockingReason),
        };
      }),
  );

const recordCleanup = (
  sql: SqlClient.SqlClient,
  input: RecordChangeCleanupInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* readCleanupChange(sql, input.changeId, idPrefix);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== "closed")
      return { ok: false as const, code: "change_not_closed" as const };
    const changed = cleanupChanged(change.cleanup, input.cleanup);
    if (changed) {
      yield* sql`
        UPDATE changes
        SET cleanup_pending = ${input.cleanup.state === "pending" ? 1 : 0},
          cleanup_blocking_reason = ${input.cleanup.blockingReason}
        WHERE id = ${internalChangeId(input.changeId, idPrefix)}
      `;
    }
    const committed = yield* readCleanupChange(sql, input.changeId, idPrefix);
    if (committed === undefined)
      return yield* invalidData("record Change cleanup", "Change disappeared");
    return { ok: true as const, changed, cleanup: committed.cleanup };
  });

const decodeCleanup = (pending: unknown, blockingReason: unknown): ChangeCleanup => {
  if (pending !== 0 && pending !== 1) throw new Error("Change cleanup state is unsupported");
  const reason = decodeStoredNullableString(blockingReason, "Change cleanup blocking reason");
  if (pending === 0 && reason !== null) throw new Error("Change cleanup relationship is invalid");
  return { state: pending === 0 ? "complete" : "pending", blockingReason: reason };
};
const cleanupChanged = (left: ChangeCleanup, right: ChangeCleanup): boolean =>
  left.state !== right.state || left.blockingReason !== right.blockingReason;
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type StoredCleanupChangeRow = {
  readonly id: number;
  readonly closeReason: string | null;
  readonly cleanupPending: unknown;
  readonly cleanupBlockingReason: unknown;
};
