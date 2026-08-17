import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ChangePublicationEvidence,
  CurrentChangeEvidenceQuery,
} from "../change/changePorts.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  type StoredValidationRunRow,
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
    if (!(yield* isOpenChange(sql, changeId, currentPassingEvidenceOperation, idPrefix))) {
      return undefined;
    }
    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns}
       FROM candidates AS candidate
       WHERE candidate.change_id = ?
       ORDER BY candidate.id DESC LIMIT 1`,
      [internalChangeId(changeId, idPrefix)],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      changeId,
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
    return yield* readPassingEvidenceForCandidate(sql, changeId, candidate, query, idPrefix);
  });

export const readCompletedCandidatePublicationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  candidateId: number,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const candidateRows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns}
       FROM candidates AS candidate
       WHERE candidate.change_id = ? AND candidate.id = ?`,
      [internalChangeId(changeId, idPrefix), candidateId],
    );
    const candidate = yield* decodeSelectedCandidate(
      candidateRows[0],
      changeId,
      completedPublicationEvidenceOperation,
      idPrefix,
    );
    if (candidate === undefined) return undefined;
    return yield* readPassingEvidenceForCandidate(
      sql,
      changeId,
      candidate,
      { validationRunId },
      idPrefix,
    );
  });

const isOpenChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<{ readonly id: number; readonly closeReason: string | null }>`
      SELECT id, close_reason AS closeReason
      FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      decodePersisted(operationName, () => {
        const row = rows[0];
        if (row === undefined) return false;
        if (publicChangeId(idPrefix, row.id) !== changeId) {
          throw new Error("Change identity does not match lookup");
        }
        return row.closeReason === null;
      }),
  );

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
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const requestedRunPredicate = query?.validationRunId === undefined ? "" : "AND id = ?";
    const parameters = [
      candidate.id,
      ...(query?.validationRunId === undefined ? [] : [query.validationRunId]),
    ];
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM validation_runs
       WHERE candidate_id = ? AND outcome = 'passed' ${requestedRunPredicate}
       ORDER BY id DESC`,
      parameters,
    );
    const highWater = yield* readCurrentAuthorityHighWater(sql, changeId, idPrefix);
    const run = rows.find(
      (row) =>
        row.candidateId === candidate.id &&
        row.highestDecisionId === highWater.highestDecisionId &&
        row.highestBlockerId === highWater.highestBlockerId,
    );
    if (run === undefined) return undefined;
    return {
      candidateId: candidate.id,
      validationRunId: run.id,
      changeBaseSha: candidate.changeBaseSha,
      headSha: candidate.headSha,
    } satisfies ChangePublicationEvidence;
  });

const readCurrentAuthorityHighWater = (
  sql: SqlClient.SqlClient,
  changeId: string,
  idPrefix: string,
) =>
  Effect.map(
    sql<{
      readonly highestDecisionId: number | null;
      readonly highestBlockerId: number | null;
    }>`
      SELECT
        (SELECT MAX(id) FROM implementation_decisions WHERE change_id = ${internalChangeId(changeId, idPrefix)}) AS highestDecisionId,
        (SELECT MAX(id) FROM implementation_blockers WHERE change_id = ${internalChangeId(changeId, idPrefix)}) AS highestBlockerId
    `,
    (rows) => rows[0] ?? { highestDecisionId: null, highestBlockerId: null },
  );
