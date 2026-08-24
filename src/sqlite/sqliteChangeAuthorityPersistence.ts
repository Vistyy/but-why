import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ChangeAuthorityPort,
  RecordImplementationDecisionInput,
} from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import { readCurrentPassingValidationEvidence } from "./sqlitePassingValidationEvidence.js";

export const openSqliteChangeAuthorityPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeAuthorityPort => ({
      raiseImplementationBlocker: (input) =>
        repository.transactionImmediate("raise Implementation Blocker", (sql) =>
          raiseBlocker(sql, input, repository.idPrefix),
        ),
      resolveImplementationBlocker: (input) =>
        repository.transactionImmediate("resolve Implementation Blocker", (sql) =>
          resolveBlocker(sql, input, repository.idPrefix),
        ),
      listImplementationBlockers: (changeId) =>
        repository.transaction("list Implementation Blockers", (sql) =>
          listBlockers(sql, changeId, repository.idPrefix),
        ),
      listImplementationDecisions: (changeId) =>
        repository.transaction("list Implementation Decisions", (sql) =>
          listDecisions(sql, changeId, repository.idPrefix),
        ),
      recordImplementationDecision: (input) =>
        repository.transactionImmediate("record Implementation Decision", (sql) =>
          recordDecision(sql, input, repository.idPrefix),
        ),
      getCurrentPassingEvidence: (changeId, query) =>
        repository.transaction("read current passing Change evidence", (sql) =>
          readCurrentPassingValidationEvidence(sql, changeId, query, repository.idPrefix),
        ),
    }),
  );

const raiseBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const state = yield* readChangeState(sql, input.changeId, idPrefix);
    if (state === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const active = yield* readActiveBlocker(sql, input.changeId, idPrefix);
    if (active !== null) return { ok: false as const, code: "change_blocked" as const };
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO implementation_blockers (
        change_id, content, resolution_content, source_type, source_id
      ) VALUES (
        ${internalChangeId(input.changeId, idPrefix)}, ${input.content}, NULL, 'implementer', NULL
      )
      RETURNING id
    `;
    const id = inserted[0]?.id;
    if (id === undefined)
      return yield* invalidData(
        "raise Implementation Blocker",
        "Blocker identity was not allocated",
      );
    const stored = yield* readBlockerById(sql, input.changeId, id, idPrefix);
    if (stored === undefined)
      return yield* invalidData("raise Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, blocker: stored };
  });

const resolveBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const state = yield* readChangeState(sql, input.changeId, idPrefix);
    if (state === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (state !== "open") return { ok: false as const, code: "no_active_blocker" as const };
    const blocker = yield* readActiveBlocker(sql, input.changeId, idPrefix);
    if (blocker === null) return { ok: false as const, code: "no_active_blocker" as const };
    yield* sql`
      UPDATE implementation_blockers SET resolution_content = ${input.content}
      WHERE id = ${blocker.id} AND resolution_content IS NULL
    `;
    const resolved = yield* readBlockerById(sql, input.changeId, blocker.id, idPrefix);
    if (resolved === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, blocker: resolved };
  });

const listBlockers = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const state = yield* readChangeState(sql, changeId, idPrefix);
    if (state === undefined) return undefined;
    return yield* readBlockers(sql, changeId, idPrefix);
  });

const readBlockers = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers WHERE change_id = ? ORDER BY id`,
      [internalChangeId(changeId, idPrefix)],
    ),
    (rows) =>
      decodePersisted("list Implementation Blockers", () =>
        decodeImplementationBlockerHistory(rows, changeId, idPrefix),
      ),
  );

const readActiveBlocker = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.map(readBlockers(sql, changeId, idPrefix), (history) => history.active);

const readBlockerById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  blockerId: number,
  idPrefix: string,
) =>
  Effect.map(readBlockers(sql, changeId, idPrefix), (history) =>
    history.blockers.find((blocker) => blocker.id === blockerId),
  );

const readChangeState = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<{ readonly id: number; readonly closeReason: string | null }>`
      SELECT id, close_reason AS closeReason
      FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      decodePersisted("read Change authority", () => {
        const row = rows[0];
        if (row === undefined) return undefined;
        if (publicChangeId(idPrefix, row.id) !== changeId) {
          throw new Error("Change identity does not match lookup");
        }
        return row.closeReason === null ? ("open" as const) : ("closed" as const);
      }),
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

const recordDecision = (
  sql: SqlClient.SqlClient,
  input: RecordImplementationDecisionInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const state = yield* readChangeState(sql, input.changeId, idPrefix);
    if (state === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO implementation_decisions (change_id, choice, rationale)
      VALUES (${internalChangeId(input.changeId, idPrefix)}, ${input.choice}, ${input.rationale})
      RETURNING id
    `;
    const id = inserted[0]?.id;
    if (id === undefined)
      return yield* invalidData(
        "record Implementation Decision",
        "Decision identity was not allocated",
      );
    const decisions = yield* listDecisions(sql, input.changeId, idPrefix);
    const decision = decisions.find((entry) => entry.id === id);
    if (decision === undefined)
      return yield* invalidData("record Implementation Decision", "Decision disappeared");
    return { ok: true as const, decision };
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
