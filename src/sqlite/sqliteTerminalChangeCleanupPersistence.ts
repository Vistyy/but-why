import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangeCleanup, changeState } from "../change/change.js";
import type { TerminalChangeCleanupPort } from "../change/changePorts.js";
import type { RecordChangeCleanupInput } from "../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeChangeState } from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

export const openSqliteTerminalChangeCleanupPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TerminalChangeCleanupPort => ({
      recordCleanup: (input) =>
        repository.transactionImmediate("record Change cleanup", (sql) =>
          recordCleanup(sql, input),
        ),
      removeReviewerSessions: (changeId) =>
        repository.transactionImmediate("remove Reviewer Sessions", (sql) =>
          Effect.asVoid(sql`DELETE FROM reviewer_sessions WHERE change_id = ${changeId}`),
        ),
    }),
  );
const readChangeState = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: unknown; readonly state: unknown }>`
      SELECT id, state FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => decodeSelectedChangeState(row, changeId));
  });
const readCleanupChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "record Change cleanup";
    const rows = yield* sql<Record<string, unknown>>`
      SELECT id, state, cleanup_state AS cleanupState,
        cleanup_blocking_reason AS cleanupBlockingReason
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const cleanupState = decodeStoredString(row["cleanupState"], "Change cleanup state");
      if (cleanupState !== "complete" && cleanupState !== "pending") {
        throw new Error("Stored Change cleanup state is unsupported");
      }
      const cleanupBlockingReason = decodeStoredNullableString(
        row["cleanupBlockingReason"],
        "Change cleanup blocking reason",
      );
      if (cleanupState === "complete" && cleanupBlockingReason !== null) {
        throw new Error("Stored completed Change cleanup has a blocking reason");
      }
      const cleanup: ChangeCleanup = {
        state: cleanupState,
        blockingReason: cleanupBlockingReason,
      };
      return { ...decodeSelectedChangeState(row, changeId), cleanup };
    });
  });
const decodeSelectedChangeState = (row: Record<string, unknown>, changeId: string) => {
  const id = decodeStoredString(row["id"], "Change ID");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row["state"]) };
};
const recordCleanup = (sql: SqlClient.SqlClient, input: RecordChangeCleanupInput) =>
  Effect.gen(function* () {
    const selected = yield* readChangeState(sql, input.changeId, "record Change cleanup");
    if (selected === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (selected.state !== changeState.closed)
      return { ok: false as const, code: "change_not_closed" as const };
    const change = yield* readCleanupChange(sql, input.changeId);
    if (change === undefined)
      return yield* invalidData("record Change cleanup", "Change disappeared");
    const changed = cleanupChanged(change.cleanup, input.cleanup);
    if (changed) {
      yield* sql`UPDATE changes SET cleanup_state = ${input.cleanup.state}, cleanup_blocking_reason = ${input.cleanup.blockingReason}, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    const committed = yield* readCleanupChange(sql, input.changeId);
    if (committed === undefined)
      return yield* invalidData("record Change cleanup", "Change disappeared");
    return { ok: true as const, changed, cleanup: committed.cleanup };
  });
const cleanupChanged = (left: ChangeCleanup, right: ChangeCleanup): boolean =>
  left.state !== right.state || left.blockingReason !== right.blockingReason;
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
