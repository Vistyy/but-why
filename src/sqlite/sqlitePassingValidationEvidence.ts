import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { changeState } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ChangePublicationEvidence,
  CurrentChangeEvidenceQuery,
} from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import type { StoredImplementationBlockerRow } from "./sqliteChangeReadModel.js";
import { decodeChangeState } from "./sqliteChangeValueDecoders.js";
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
  query: CurrentChangeEvidenceQuery | undefined,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const authority = yield* readOpenChangeAuthority(
      sql,
      changeId,
      currentPassingEvidenceOperation,
      idPrefix,
    );
    if (authority === undefined) return undefined;

    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns} FROM current_candidates AS selection
       JOIN candidates AS candidate ON candidate.id = selection.candidate_id
       WHERE selection.change_id = ?`,
      [internalChangeId(authority.id, idPrefix)],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      authority.id,
      currentPassingEvidenceOperation,
      idPrefix,
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
      idPrefix,
    );
  });

export const readCompletedCandidatePublicationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  candidateId: string,
  validationRunId: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const authority = yield* readOpenChangeAuthority(
      sql,
      changeId,
      completedPublicationEvidenceOperation,
      idPrefix,
    );
    if (authority === undefined) return undefined;

    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns} FROM candidates AS candidate
       WHERE candidate.change_id = ? AND candidate.id = ?`,
      [internalChangeId(authority.id, idPrefix), candidateId],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      authority.id,
      completedPublicationEvidenceOperation,
      idPrefix,
    );
    if (candidate === undefined) return undefined;

    return yield* readPassingEvidenceForCandidate(
      sql,
      authority.id,
      candidate,
      { validationRunId },
      completedPublicationEvidenceOperation,
      idPrefix,
    );
  });

const readOpenChangeAuthority = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeStateRow>`
      SELECT id, state FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) return undefined;
      const id = publicChangeId(idPrefix, row.id);
      if (id !== changeId) throw new Error("Change identity does not match lookup");
      return decodeChangeState(row.state) === changeState.open ? { id } : undefined;
    });
  });

const decodeSelectedCandidate = (
  row: StoredCandidateRow | undefined,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  decodePersisted(operationName, () => {
    if (row === undefined) return undefined;
    const candidate = decodeCandidate(row, idPrefix);
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
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const requestedRunPredicate = query?.validationRunId === undefined ? "" : "AND id = ?";
    const requestedRunParameters = [
      candidate.id,
      ...(query?.validationRunId === undefined ? [] : [query.validationRunId]),
    ];
    const eligibleRows = yield* sql.unsafe<{ readonly found: number }>(
      `SELECT 1 AS found FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         ${requestedRunPredicate}
       LIMIT 1`,
      requestedRunParameters,
    );
    if (eligibleRows.length === 0) return undefined;

    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         ${requestedRunPredicate}
       ORDER BY created_at DESC, id DESC`,
      requestedRunParameters,
    );
    for (const row of rows) {
      const run = yield* decodePersisted(operationName, () => decodeValidationRun(row));
      yield* decodePersisted(operationName, () =>
        validateValidationRunImplementationDecisionRelationships(run, changeId),
      );
      if (run.record.candidateId !== candidate.id) {
        return yield* invalidData(operationName, "Validation Run belongs to another Candidate");
      }
      const latestResolvedBlockerIdAtRun = yield* readLatestResolvedBlockerIdAtValidationRun(
        sql,
        changeId,
        run.record.createdAt,
        operationName,
        idPrefix,
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

const readLatestResolvedBlockerIdAtValidationRun = (
  sql: SqlClient.SqlClient,
  changeId: string,
  validationRunCreatedAt: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredResolvedBlockerIdentityRow>(
      `${resolvedBlockerIdentitySelection}
       WHERE change_id = ? AND resolved_at IS NOT NULL AND resolved_at <= ?
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [internalChangeId(changeId, idPrefix), validationRunCreatedAt],
    ),
    (rows) => decodeLatestResolvedBlockerId(rows[0], changeId, operationName, idPrefix),
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
  idPrefix: string,
) =>
  decodePersisted(operationName, () => {
    if (row === undefined) return null;
    if (publicChangeId(idPrefix, row.changeId) !== changeId) {
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
  readonly id: number;
  readonly state: unknown;
};
