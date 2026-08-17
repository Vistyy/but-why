import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { changeState } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ChangeAuthorityPort,
  RecordImplementationDecisionInput,
} from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import { decodeChangeState } from "./sqliteChangeValueDecoders.js";
import { readCurrentPassingValidationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

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
    const change = yield* readChangeState(
      sql,
      input.changeId,
      "raise Implementation Blocker",
      idPrefix,
    );
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return { ok: false as const, code: "change_not_open" as const };
    const active = yield* readActiveBlocker(
      sql,
      input.changeId,
      "raise Implementation Blocker",
      idPrefix,
    );
    if (active !== null) return { ok: false as const, code: "change_blocked" as const };
    const id = randomUUID();
    yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content) VALUES (${id}, ${internalChangeId(input.changeId, idPrefix)}, ${input.now}, ${input.content})`;
    const stored = yield* readBlockerById(
      sql,
      input.changeId,
      id,
      "raise Implementation Blocker",
      idPrefix,
    );
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
    const selected = yield* readChangeState(
      sql,
      input.changeId,
      "resolve Implementation Blocker",
      idPrefix,
    );
    if (selected === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (selected.state === changeState.closed)
      return { ok: false as const, code: "no_active_blocker" as const };
    const blocker = yield* readActiveBlocker(
      sql,
      input.changeId,
      "resolve Implementation Blocker",
      idPrefix,
    );
    if (blocker === null) return { ok: false as const, code: "no_active_blocker" as const };
    const resolutionId = randomUUID();
    yield* sql`UPDATE implementation_blockers SET resolved_at = ${input.now}, resolution_id = ${resolutionId}, resolution_recorded_at = ${input.now}, resolution_content = ${input.content} WHERE id = ${blocker.id}`;
    const resolved = yield* readBlockerById(
      sql,
      input.changeId,
      blocker.id,
      "resolve Implementation Blocker",
      idPrefix,
    );
    if (resolved === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, blocker: resolved };
  });
const listBlockers = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const exists = yield* sql<{ readonly id: number }>`
      SELECT id FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    if (exists.length === 0) return undefined;
    yield* decodePersisted("list Implementation Blockers", () => {
      if (publicChangeId(idPrefix, exists[0]?.id ?? 0) !== changeId)
        throw new Error("Change identity does not match lookup");
    });
    return yield* readBlockers(sql, changeId, "list Implementation Blockers", idPrefix);
  });
const readBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE change_id = ?`,
      [internalChangeId(changeId, idPrefix)],
    ),
    (rows) =>
      decodePersisted(operationName, () =>
        decodeImplementationBlockerHistory(rows, changeId, idPrefix),
      ),
  );
const readActiveBlocker = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.map(
    readSelectedBlockers(
      sql,
      changeId,
      operationName,
      "change_id = ? AND resolved_at IS NULL",
      [internalChangeId(changeId, idPrefix)],
      idPrefix,
    ),
    (history) => history.active,
  );
const readBlockerById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  blockerId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.map(
    readSelectedBlockers(
      sql,
      changeId,
      operationName,
      "change_id = ? AND id = ?",
      [internalChangeId(changeId, idPrefix), blockerId],
      idPrefix,
    ),
    (history) => history.blockers[0],
  );
const readSelectedBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  predicate: string,
  parameters: readonly unknown[],
  idPrefix: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () =>
        decodeImplementationBlockerHistory(rows, changeId, idPrefix),
      ),
  );
const readChangeState = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeStateRow>`
      SELECT id, state FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () =>
      decodeSelectedChangeState(row, changeId, idPrefix),
    );
  });
const decodeSelectedChangeState = (
  row: StoredChangeStateRow,
  changeId: string,
  idPrefix: string,
) => {
  const id = publicChangeId(idPrefix, row.id);
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row.state) };
};
const listDecisions = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId, idPrefix),
      ),
  );
const readDecisionById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  decisionId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${internalChangeId(changeId, idPrefix)} AND id = ${decisionId}
    `,
    (rows) =>
      decodePersisted(
        operationName,
        () => decodeImplementationDecisions(rows, changeId, idPrefix)[0],
      ),
  );
const recordDecision = (
  sql: SqlClient.SqlClient,
  input: RecordImplementationDecisionInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* readChangeState(
      sql,
      input.changeId,
      "record Implementation Decision",
      idPrefix,
    );
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const id = randomUUID();
    yield* sql`
      INSERT INTO implementation_decisions (id, change_id, recorded_at, choice, rationale)
      VALUES (${id}, ${internalChangeId(input.changeId, idPrefix)}, ${input.now}, ${input.choice}, ${input.rationale})
    `;
    const decision = yield* readDecisionById(
      sql,
      input.changeId,
      id,
      "record Implementation Decision",
      idPrefix,
    );
    if (decision === undefined)
      return yield* invalidData("record Implementation Decision", "Decision disappeared");
    return { ok: true as const, decision };
  });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
type StoredChangeStateRow = {
  readonly id: number;
  readonly state: unknown;
};
