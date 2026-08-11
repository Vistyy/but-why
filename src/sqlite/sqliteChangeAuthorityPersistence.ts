import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { changeState } from "../change/change.js";
import type {
  ChangeAuthorityPort,
  ChangePublicationEvidence,
  CurrentChangeEvidenceQuery,
  RecordImplementationDecisionInput,
} from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  candidateReadColumns,
  decodeCandidate,
  decodeValidationRun,
  type UnknownCandidateRow,
  type UnknownValidationRunRow,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
  validationRunReadColumns,
} from "./sqliteCandidateValidationReadModel.js";
import {
  decodeChangeState,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type UnknownImplementationBlockerRow,
  type UnknownImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredSqlitePositiveInteger,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeAuthorityPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeAuthorityPort => ({
      raiseImplementationBlocker: (input) =>
        repository.transactionImmediate("raise Implementation Blocker", (sql) =>
          raiseBlocker(sql, input),
        ),
      resolveImplementationBlocker: (input) =>
        repository.transactionImmediate("resolve Implementation Blocker", (sql) =>
          resolveBlocker(sql, input),
        ),
      listImplementationBlockers: (changeId) =>
        repository.transaction("list Implementation Blockers", (sql) =>
          listBlockers(sql, changeId),
        ),
      listImplementationDecisions: (changeId) =>
        repository.transaction("list Implementation Decisions", (sql) =>
          listDecisions(sql, changeId),
        ),
      recordImplementationDecision: (input) =>
        repository.transactionImmediate("record Implementation Decision", (sql) =>
          recordDecision(sql, input),
        ),
      getCurrentPassingEvidence: (changeId, query) =>
        repository.transaction("read current passing Change evidence", (sql) =>
          getPassingEvidence(sql, changeId, query, false),
        ),
    }),
  );
const raiseBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const change = yield* readChangeState(sql, input.changeId, "raise Implementation Blocker");
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return { ok: false as const, code: "change_not_open" as const };
    const active = yield* readActiveBlocker(sql, input.changeId, "raise Implementation Blocker");
    if (active !== null) return { ok: false as const, code: "change_blocked" as const };
    const id = randomUUID();
    yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content) VALUES (${id}, ${input.changeId}, ${input.now}, ${input.content})`;
    const stored = yield* readBlockerById(sql, input.changeId, id, "raise Implementation Blocker");
    if (stored === undefined)
      return yield* invalidData("raise Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, blocker: stored };
  });
const resolveBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const selected = yield* readChangeState(sql, input.changeId, "resolve Implementation Blocker");
    if (selected === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (selected.state === changeState.closed)
      return { ok: false as const, code: "no_active_blocker" as const };
    const change = yield* readBlockerResolutionChange(sql, input.changeId);
    if (change === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Change disappeared");
    const blocker = yield* readActiveBlocker(sql, input.changeId, "resolve Implementation Blocker");
    if (blocker === null) return { ok: false as const, code: "no_active_blocker" as const };
    const resolutionId = randomUUID();
    yield* sql`UPDATE implementation_blockers SET resolved_at = ${input.now}, resolution_id = ${resolutionId}, resolution_recorded_at = ${input.now}, resolution_content = ${input.content} WHERE id = ${blocker.id}`;
    if (change.taskId !== null && change.acceptanceContext !== null) {
      yield* sql`UPDATE changes SET acceptance_context = json_set(acceptance_context, '$.resolutions', json_insert(COALESCE(json_extract(acceptance_context, '$.resolutions'), '[]'), '$[#]', ${input.content})), updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    const resolved = yield* readBlockerById(
      sql,
      input.changeId,
      blocker.id,
      "resolve Implementation Blocker",
    );
    if (resolved === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, blocker: resolved };
  });
const listBlockers = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const exists = yield* sql<
      Record<string, unknown>
    >`SELECT id FROM changes WHERE id = ${changeId}`;
    if (exists.length === 0) return undefined;
    yield* decodePersisted("list Implementation Blockers", () =>
      decodeStoredString(exists[0]?.["id"], "Change ID"),
    );
    return yield* readBlockers(sql, changeId, "list Implementation Blockers");
  });
const readBlockers = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE change_id = ?`,
      [changeId],
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );
const readActiveBlocker = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND resolved_at IS NULL", [
      changeId,
    ]),
    (history) => history.active,
  );
const readBlockerById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  blockerId: string,
  operationName: string,
) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND id = ?", [
      changeId,
      blockerId,
    ]),
    (history) => history.blockers[0],
  );
const readLatestResolvedBlockerId = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  resolvedAtOrBefore?: string,
) =>
  Effect.gen(function* () {
    const upperBound = resolvedAtOrBefore === undefined ? "" : "AND resolved_at <= ?";
    const rows = yield* sql.unsafe<{
      readonly id: unknown;
      readonly changeId: unknown;
      readonly sequence: unknown;
      readonly sequenceType: unknown;
      readonly resolvedAt: unknown;
      readonly resolutionId: unknown;
      readonly resolutionRecordedAt: unknown;
      readonly resolutionContent: unknown;
    }>(
      `SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, resolved_at AS resolvedAt,
        resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
        resolution_content AS resolutionContent
       FROM implementation_blockers
       WHERE change_id = ? AND resolved_at IS NOT NULL ${upperBound}
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      resolvedAtOrBefore === undefined ? [changeId] : [changeId, resolvedAtOrBefore],
    );
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) return null;
      const owner = decodeStoredString(row.changeId, "Implementation Blocker Change ID");
      if (owner !== changeId) throw new Error("Implementation Blocker belongs to another Change");
      decodeStoredSqlitePositiveInteger(
        row.sequence,
        row.sequenceType,
        "Implementation Blocker sequence",
      );
      decodeStoredString(row.resolvedAt, "Implementation Blocker resolution time");
      decodeStoredString(row.resolutionId, "Resolution ID");
      decodeStoredString(row.resolutionRecordedAt, "Resolution recorded time");
      decodeStoredString(row.resolutionContent, "Resolution content");
      return decodeStoredString(row.id, "Implementation Blocker ID");
    });
  });
const readSelectedBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  predicate: string,
  parameters: readonly unknown[],
) =>
  Effect.flatMap(
    sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
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
const readBlockerResolutionChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "resolve Implementation Blocker";
    const rows = yield* sql<{
      readonly id: unknown;
      readonly state: unknown;
      readonly taskId: unknown;
      readonly acceptanceContext: unknown;
    }>`
      SELECT id, state, task_id AS taskId, acceptance_context AS acceptanceContext
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const selected = decodeSelectedChangeState(row, changeId);
      const taskId = decodeStoredNullableString(row.taskId, "Change Task ID");
      const encodedAcceptanceContext = decodeStoredNullableString(
        row.acceptanceContext,
        "Change Acceptance Context",
      );
      if ((taskId === null) !== (encodedAcceptanceContext === null)) {
        throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
      }
      return {
        ...selected,
        taskId,
        acceptanceContext:
          encodedAcceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
      };
    });
  });
const decodeSelectedChangeState = (row: Record<string, unknown>, changeId: string) => {
  const id = decodeStoredString(row["id"], "Change ID");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row["state"]) };
};
const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );
const readDecisionById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  decisionId: string,
  operationName: string,
) =>
  Effect.flatMap(
    sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${changeId} AND id = ${decisionId}
    `,
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationDecisions(rows, changeId)[0]),
  );
const recordDecision = (sql: SqlClient.SqlClient, input: RecordImplementationDecisionInput) =>
  Effect.gen(function* () {
    const change = yield* readChangeState(sql, input.changeId, "record Implementation Decision");
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const id = randomUUID();
    yield* sql`
      INSERT INTO implementation_decisions (id, change_id, recorded_at, choice, rationale)
      VALUES (${id}, ${input.changeId}, ${input.now}, ${input.choice}, ${input.rationale})
    `;
    const decision = yield* readDecisionById(
      sql,
      input.changeId,
      id,
      "record Implementation Decision",
    );
    if (decision === undefined)
      return yield* invalidData("record Implementation Decision", "Decision disappeared");
    return { ok: true as const, decision };
  });
const getPassingEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  query: CurrentChangeEvidenceQuery | undefined,
  allowHistoricalCandidate: boolean,
) =>
  Effect.gen(function* () {
    const operationName = allowHistoricalCandidate
      ? "read completed Candidate Publication evidence"
      : "read current passing Change evidence";
    const authorityRows = yield* sql<{
      readonly id: unknown;
      readonly state: unknown;
    }>`SELECT id, state FROM changes WHERE id = ${changeId}`;
    const authority = yield* decodePersisted(operationName, () => {
      const row = authorityRows[0];
      if (row === undefined) return undefined;
      const id = decodeStoredString(row.id, "Change ID");
      if (id !== changeId) throw new Error("Change identity does not match evidence lookup");
      if (decodeChangeState(row.state) !== changeState.open) return undefined;
      return { id };
    });
    if (authority === undefined) return undefined;

    const candidatePredicate =
      allowHistoricalCandidate && query?.candidateId !== undefined
        ? "candidate.change_id = ? AND candidate.id = ?"
        : `candidate.id = (
           SELECT current.id FROM candidates AS current
           WHERE current.change_id = ?
           ORDER BY current.created_at DESC, current.id DESC LIMIT 1
         )`;
    const candidateParameters = [
      authority.id,
      ...(allowHistoricalCandidate && query?.candidateId !== undefined ? [query.candidateId] : []),
    ];
    const candidateRows = yield* sql.unsafe<UnknownCandidateRow>(
      `SELECT ${candidateReadColumns} FROM candidates AS candidate WHERE ${candidatePredicate}`,
      candidateParameters,
    );
    const candidate = yield* decodePersisted(operationName, () => {
      const row = candidateRows[0];
      if (row === undefined) return undefined;
      const decoded = decodeCandidate(row);
      if (decoded.changeId !== authority.id) {
        throw new Error("Evidence Candidate belongs to another Change");
      }
      return decoded;
    });
    if (
      candidate === undefined ||
      (query?.candidateId !== undefined && candidate.id !== query.candidateId) ||
      (query?.changeBaseSha !== undefined && candidate.changeBaseSha !== query.changeBaseSha)
    ) {
      return undefined;
    }

    const requestedPolicy = query?.policy;
    const requestedPolicySnapshot =
      requestedPolicy === undefined
        ? undefined
        : yield* Effect.try({
            try: () => encodeSqliteCandidateValidationPolicy(requestedPolicy),
            catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
          });
    const requestedRunPredicate = query?.validationRunId === undefined ? "" : "AND id = ?";
    const requestedPolicyPredicate =
      requestedPolicySnapshot === undefined ? "" : "AND policy_snapshot = ?";
    const requestedRunParameters = [
      candidate.id,
      ...(query?.validationRunId === undefined ? [] : [query.validationRunId]),
      ...(requestedPolicySnapshot === undefined ? [] : [requestedPolicySnapshot]),
    ];
    const eligibleRows = yield* sql.unsafe<{ readonly found: unknown }>(
      `SELECT 1 AS found FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         ${requestedRunPredicate} ${requestedPolicyPredicate}
       LIMIT 1`,
      requestedRunParameters,
    );
    if (eligibleRows.length === 0) return undefined;

    const acceptanceContextRows = yield* sql<{
      readonly id: unknown;
      readonly taskId: unknown;
      readonly acceptanceContext: unknown;
    }>`SELECT id, task_id AS taskId, acceptance_context AS acceptanceContext
       FROM changes WHERE id = ${authority.id}`;
    const expectedAcceptanceContext = yield* decodePersisted(operationName, () => {
      const authorityRow = acceptanceContextRows[0];
      const id = decodeStoredString(authorityRow?.id, "Change ID");
      if (id !== authority.id) throw new Error("Change disappeared during evidence lookup");
      const taskId = decodeStoredNullableString(authorityRow?.taskId, "Change Task ID");
      const encoded = decodeStoredNullableString(
        authorityRow?.acceptanceContext,
        "Change Acceptance Context",
      );
      if ((taskId === null) !== (encoded === null)) {
        throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
      }
      return encoded === null ? undefined : decodeSqliteAcceptanceContextSnapshot(encoded);
    });
    const expectedDecisionsSnapshot = JSON.stringify(yield* listDecisions(sql, authority.id));
    const currentLatestResolvedBlockerId = yield* readLatestResolvedBlockerId(
      sql,
      authority.id,
      operationName,
    );

    const rows = yield* sql.unsafe<UnknownValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         ${requestedRunPredicate} ${requestedPolicyPredicate}
         AND implementation_decisions = ? AND latest_resolved_blocker_id IS ?
       ORDER BY created_at DESC, id DESC`,
      [...requestedRunParameters, expectedDecisionsSnapshot, currentLatestResolvedBlockerId],
    );
    for (const row of rows) {
      const run = yield* decodePersisted(operationName, () => decodeValidationRun(row));
      yield* decodePersisted(operationName, () =>
        validateValidationRunImplementationDecisionRelationships(run, authority.id),
      );
      if (run.record.candidateId !== candidate.id) {
        return yield* invalidData(operationName, "Validation Run belongs to another Candidate");
      }
      if (!isDeepStrictEqual(run.record.policy.acceptanceContext, expectedAcceptanceContext)) {
        continue;
      }
      const latestResolvedBlockerIdAtRun = yield* readLatestResolvedBlockerId(
        sql,
        authority.id,
        operationName,
        run.record.createdAt,
      );
      yield* decodePersisted(operationName, () =>
        validateValidationRunLatestResolvedBlockerRelationship(run, latestResolvedBlockerIdAtRun),
      );
      return {
        candidateId: candidate.id,
        validationRunId: run.record.id,
        changeBaseSha: candidate.changeBaseSha,
        headSha: candidate.headSha,
      } satisfies ChangePublicationEvidence;
    }
    return undefined;
  });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
