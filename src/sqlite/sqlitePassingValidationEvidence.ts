import { isDeepStrictEqual } from "node:util";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { changeState } from "../change/change.js";
import type {
  ChangePublicationEvidence,
  CurrentChangeEvidenceQuery,
} from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationDecisions,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  decodeValidationRun,
  type StoredValidationRunRow,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
  validationRunReadColumns,
} from "./sqliteValidationRunStorage.js";

const currentPassingEvidenceOperation = "read current passing Change evidence";
const completedPublicationEvidenceOperation = "read completed Candidate Publication evidence";

export const readCurrentPassingValidationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  query?: CurrentChangeEvidenceQuery,
) =>
  Effect.gen(function* () {
    const authority = yield* readOpenChangeAuthority(
      sql,
      changeId,
      currentPassingEvidenceOperation,
    );
    if (authority === undefined) return undefined;

    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns} FROM candidates AS candidate
       WHERE candidate.id = (
         SELECT current.id FROM candidates AS current
         WHERE current.change_id = ?
         ORDER BY current.created_at DESC, current.id DESC LIMIT 1
       )`,
      [authority.id],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      authority.id,
      currentPassingEvidenceOperation,
    );
    if (
      candidate === undefined ||
      (query?.candidateId !== undefined && candidate.id !== query.candidateId) ||
      (query?.changeBaseSha !== undefined && candidate.changeBaseSha !== query.changeBaseSha)
    ) {
      return undefined;
    }

    return yield* readPassingEvidenceForCandidate(
      sql,
      authority.id,
      candidate,
      query,
      currentPassingEvidenceOperation,
    );
  });

export const readCompletedCandidatePublicationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  candidateId: string,
  validationRunId: string,
) =>
  Effect.gen(function* () {
    const authority = yield* readOpenChangeAuthority(
      sql,
      changeId,
      completedPublicationEvidenceOperation,
    );
    if (authority === undefined) return undefined;

    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns} FROM candidates AS candidate
       WHERE candidate.change_id = ? AND candidate.id = ?`,
      [authority.id, candidateId],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      authority.id,
      completedPublicationEvidenceOperation,
    );
    if (candidate === undefined) return undefined;

    return yield* readPassingEvidenceForCandidate(
      sql,
      authority.id,
      candidate,
      { validationRunId },
      completedPublicationEvidenceOperation,
    );
  });

const readOpenChangeAuthority = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeStateRow>`
      SELECT id, state FROM changes WHERE id = ${changeId}
    `;
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) return undefined;
      const id = decodeStoredString(row.id, "Change id");
      if (id !== changeId) throw new Error("Change identity does not match lookup");
      return decodeChangeState(row.state) === changeState.open ? { id } : undefined;
    });
  });

const decodeSelectedCandidate = (
  row: StoredCandidateRow | undefined,
  changeId: string,
  operationName: string,
) =>
  decodePersisted(operationName, () => {
    if (row === undefined) return undefined;
    const candidate = decodeCandidate(row);
    if (candidate.changeId !== changeId) {
      throw new Error("Evidence Candidate belongs to another Change");
    }
    return candidate;
  });

const readPassingEvidenceForCandidate = (
  sql: SqlClient.SqlClient,
  changeId: string,
  candidate: ReturnType<typeof decodeCandidate>,
  query: CurrentChangeEvidenceQuery | undefined,
  operationName: string,
) =>
  Effect.gen(function* () {
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
    const eligibleRows = yield* sql.unsafe<{ readonly found: number }>(
      `SELECT 1 AS found FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         ${requestedRunPredicate} ${requestedPolicyPredicate}
       LIMIT 1`,
      requestedRunParameters,
    );
    if (eligibleRows.length === 0) return undefined;

    const expectedAcceptanceContext = yield* readAcceptanceContext(sql, changeId, operationName);
    const expectedDecisionsSnapshot = JSON.stringify(yield* listDecisions(sql, changeId));
    const currentLatestResolvedBlockerId = yield* readCurrentLatestResolvedBlockerId(
      sql,
      changeId,
      operationName,
    );

    const rows = yield* sql.unsafe<StoredValidationRunRow>(
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
        validateValidationRunImplementationDecisionRelationships(run, changeId),
      );
      if (run.record.candidateId !== candidate.id) {
        return yield* invalidData(operationName, "Validation Run belongs to another Candidate");
      }
      if (!isDeepStrictEqual(run.record.policy.acceptanceContext, expectedAcceptanceContext)) {
        continue;
      }
      const latestResolvedBlockerIdAtRun = yield* readLatestResolvedBlockerIdAtValidationRun(
        sql,
        changeId,
        run.record.createdAt,
        operationName,
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

const readAcceptanceContext = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: unknown; readonly acceptanceContext: unknown }>`
      SELECT id, acceptance_context AS acceptanceContext
      FROM changes WHERE id = ${changeId}
    `;
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) throw new Error("Change disappeared during evidence lookup");
      const id = decodeStoredString(row.id, "Change id");
      if (id !== changeId) throw new Error("Change disappeared during evidence lookup");
      const encoded = decodeStoredNullableString(
        row.acceptanceContext,
        "Change Acceptance Context",
      );
      return encoded === null ? undefined : decodeSqliteAcceptanceContextSnapshot(encoded);
    });
  });

const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );

const readCurrentLatestResolvedBlockerId = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredResolvedBlockerIdentityRow>(
      `${resolvedBlockerIdentitySelection}
       WHERE change_id = ? AND resolved_at IS NOT NULL
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [changeId],
    ),
    (rows) => decodeLatestResolvedBlockerId(rows[0], changeId, operationName),
  );

const readLatestResolvedBlockerIdAtValidationRun = (
  sql: SqlClient.SqlClient,
  changeId: string,
  validationRunCreatedAt: string,
  operationName: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredResolvedBlockerIdentityRow>(
      `${resolvedBlockerIdentitySelection}
       WHERE change_id = ? AND resolved_at IS NOT NULL AND resolved_at <= ?
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [changeId, validationRunCreatedAt],
    ),
    (rows) => decodeLatestResolvedBlockerId(rows[0], changeId, operationName),
  );

const resolvedBlockerIdentitySelection = `
  SELECT id, change_id AS changeId, sequence, resolved_at AS resolvedAt,
    resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
    resolution_content AS resolutionContent
  FROM implementation_blockers
`;

const decodeLatestResolvedBlockerId = (
  row: StoredResolvedBlockerIdentityRow | undefined,
  changeId: string,
  operationName: string,
) =>
  decodePersisted(operationName, () => {
    if (row === undefined) return null;
    if (row.changeId !== changeId) {
      throw new Error("Implementation Blocker belongs to another Change");
    }
    return row.id;
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type StoredResolvedBlockerIdentityRow = Pick<
  StoredImplementationBlockerRow,
  | "id"
  | "changeId"
  | "sequence"
  | "resolvedAt"
  | "resolutionId"
  | "resolutionRecordedAt"
  | "resolutionContent"
>;

type StoredChangeStateRow = {
  readonly id: unknown;
  readonly state: unknown;
};
