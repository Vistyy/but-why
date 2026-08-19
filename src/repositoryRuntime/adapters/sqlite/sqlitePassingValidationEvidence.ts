import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type {
  ChangePublicationEvidence,
  CurrentChangeEvidenceQuery,
} from "../../../change/changePorts.js";
import { latestResolvedBlockerId } from "../../../change/implementationBlocker.js";
import { isValidationRunEligibleForCurrentChangeAuthority } from "../../../change/validationRun/validationRun.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import { readImplementationBlockerHistory } from "./sqliteChangeAuthorityHistory.js";
import { decodePersisted } from "./sqlitePersistedData.js";
import { requireCoherentValidationCompletion } from "./sqliteValidationCompletion.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

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
    return yield* readPassingEvidenceForCandidate(
      sql,
      candidate,
      query,
      currentPassingEvidenceOperation,
      idPrefix,
    );
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
      candidate,
      { validationRunId },
      completedPublicationEvidenceOperation,
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
  candidate: ReturnType<typeof decodeCandidate>,
  query: CurrentChangeEvidenceQuery | undefined,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const requestedRunPredicate = query?.validationRunId === undefined ? "" : "AND id = ?";
    const parameters = [
      candidate.id,
      ...(query?.validationRunId === undefined ? [] : [query.validationRunId]),
    ];
    const rows = yield* sql.unsafe<{
      readonly id: number;
      readonly highestBlockerId: number | null;
    }>(
      `SELECT id, highest_blocker_id AS highestBlockerId
       FROM validation_runs
       WHERE candidate_id = ? AND outcome = 'passed' ${requestedRunPredicate}
       ORDER BY id DESC`,
      parameters,
    );
    const validationRunId = rows[0]?.id;
    if (validationRunId === undefined) return undefined;
    const run = yield* readValidationRunById(sql, validationRunId, operationName, idPrefix);
    const changeRows = yield* sql<{
      readonly id: number;
      readonly acceptanceContext: string | null;
    }>`
      SELECT id, initial_acceptance_context AS acceptanceContext
      FROM changes
      WHERE id = ${internalChangeId(candidate.changeId, idPrefix)}
    `;
    const changeAuthority = yield* decodePersisted(operationName, () => {
      const row = changeRows[0];
      if (row === undefined || publicChangeId(idPrefix, row.id) !== candidate.changeId) {
        throw new Error("Passing Validation Run requires its owning Change");
      }
      return { hasAcceptanceContext: row.acceptanceContext !== null };
    });
    const blockerHistory = yield* readImplementationBlockerHistory(
      sql,
      candidate.changeId,
      operationName,
      idPrefix,
    );
    if (
      run !== undefined &&
      !isValidationRunEligibleForCurrentChangeAuthority({
        hasAcceptanceContext: changeAuthority.hasAcceptanceContext,
        runHighestBlockerId: rows[0]?.highestBlockerId ?? null,
        currentHighestBlockerId: latestResolvedBlockerId(blockerHistory),
      })
    ) {
      return undefined;
    }
    yield* requireCoherentValidationCompletion(
      sql,
      validationRunId,
      "passed",
      operationName,
      idPrefix,
    );
    return yield* decodePersisted(operationName, () => {
      if (run === undefined) throw new Error("Passing Validation Run was not selected");
      if (run.candidateId !== candidate.id) {
        throw new Error("Passing Validation Run belongs to another Candidate");
      }
      if (run.outcome !== "passed") throw new Error("Validation Run did not pass");
      return {
        candidateId: candidate.id,
        validationRunId: run.id,
        changeBaseSha: candidate.changeBaseSha,
        headSha: candidate.headSha,
      } satisfies ChangePublicationEvidence;
    });
  });
