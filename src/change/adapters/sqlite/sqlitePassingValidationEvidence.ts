import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";
import type { ChangePublicationEvidence, CurrentChangeEvidenceQuery } from "../../changePorts.js";
import { latestResolvedBlockerId } from "../../implementationBlocker.js";
import { isValidationRunEligibleForCurrentChangeAuthority } from "../../validationRun/validationRun.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import { readImplementationBlockerHistory } from "./sqliteChangeAuthorityHistory.js";
import { requireCoherentValidationCompletion } from "./sqliteValidationCompletion.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

const currentPassingEvidenceOperation = "read current passing Change evidence";
const completedPublicationEvidenceOperation = "read completed Candidate Publication evidence";
const currentPassingEvidenceBatchSize = 500;

type CurrentChangeActivityEvidence = {
  readonly hasActiveValidation: boolean;
  readonly hasCurrentPassingEvidence: boolean;
};

type StoredCurrentCandidateRow = StoredCandidateRow & {
  readonly validationRunId: number;
};

type StoredValidationEvidenceRow = {
  readonly validationRunId: number;
  readonly findings: string;
  readonly artifacts: string;
  readonly toolingFailure: string | null;
};

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

export const readCurrentPassingValidationEvidenceForChanges = (
  sql: SqlClient.SqlClient,
  changeIds: readonly string[],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const requestedChangeIds = [...new Set(changeIds)];
    const activity = new Map<string, CurrentChangeActivityEvidence>();
    const activeValidationRows = yield* readBatchedRows<{
      readonly changeId: number;
      readonly activeValidations: number;
    }>(
      sql,
      requestedChangeIds,
      (placeholders) => `
        SELECT candidate.change_id AS changeId, COUNT(*) AS activeValidations
        FROM validation_runs AS run
        JOIN candidates AS candidate ON candidate.id = run.candidate_id
        WHERE candidate.change_id IN (${placeholders}) AND run.outcome IS NULL
        GROUP BY candidate.change_id`,
      idPrefix,
    );
    yield* decodePersisted(currentPassingEvidenceOperation, () => {
      for (const row of activeValidationRows) {
        const changeId = publicChangeId(idPrefix, row.changeId);
        if (row.activeValidations > 1) {
          throw new Error("Change has more than one active Validation Run");
        }
        activity.set(changeId, {
          hasActiveValidation: row.activeValidations === 1,
          hasCurrentPassingEvidence: false,
        });
      }
    });

    const passingChangeIds = requestedChangeIds.filter(
      (changeId) => !activity.get(changeId)?.hasActiveValidation,
    );
    const candidateRows = yield* readBatchedRows<StoredCurrentCandidateRow>(
      sql,
      passingChangeIds,
      (placeholders) => `
        SELECT ${candidateReadColumns}, passing.id AS validationRunId
        FROM candidates AS candidate
        JOIN validation_runs AS passing
          ON passing.candidate_id = candidate.id AND passing.outcome = 'passed'
        WHERE candidate.change_id IN (${placeholders})
          AND candidate.id = (
            SELECT MAX(latest.id) FROM candidates AS latest
            WHERE latest.change_id = candidate.change_id
          )
          AND passing.id = (
            SELECT MAX(latestPassing.id) FROM validation_runs AS latestPassing
            WHERE latestPassing.candidate_id = candidate.id AND latestPassing.outcome = 'passed'
          )
        ORDER BY candidate.id DESC`,
      idPrefix,
    );
    yield* validateSelectedPassingEvidence(sql, candidateRows);
    const candidates = yield* decodePersisted(currentPassingEvidenceOperation, () =>
      candidateRows.map((row) => decodeCandidate(row, idPrefix)),
    );
    for (const candidate of candidates) {
      activity.set(candidate.changeId, {
        hasActiveValidation: false,
        hasCurrentPassingEvidence: true,
      });
    }
    return activity;
  });

const validateSelectedPassingEvidence = (
  sql: SqlClient.SqlClient,
  candidateRows: readonly StoredCurrentCandidateRow[],
) =>
  Effect.gen(function* () {
    const runIds = [...new Set(candidateRows.map((row) => row.validationRunId))];
    const rows: StoredValidationEvidenceRow[] = [];
    for (let start = 0; start < runIds.length; start += currentPassingEvidenceBatchSize) {
      const batch = runIds.slice(start, start + currentPassingEvidenceBatchSize);
      rows.push(
        ...(yield* sql.unsafe<StoredValidationEvidenceRow>(
          `SELECT validation_run_id AS validationRunId, findings, artifacts,
              tooling_failure AS toolingFailure
           FROM validation_phase_results
           WHERE validation_run_id IN (${batch.map(() => "?").join(", ")})`,
          batch,
        )),
      );
    }
    yield* decodePersisted(currentPassingEvidenceOperation, () => {
      const rowsByRun = new Map<number, StoredValidationEvidenceRow[]>();
      for (const row of rows) {
        const current = rowsByRun.get(row.validationRunId) ?? [];
        const findings: unknown = JSON.parse(row.findings) as unknown;
        const artifacts: unknown = JSON.parse(row.artifacts) as unknown;
        if (!Array.isArray(findings) || !Array.isArray(artifacts)) {
          throw new Error("Stored validation evidence is not an array");
        }
        if (row.toolingFailure !== null) JSON.parse(row.toolingFailure) as unknown;
        current.push(row);
        rowsByRun.set(row.validationRunId, current);
      }
      for (const row of candidateRows) {
        if (!rowsByRun.has(row.validationRunId)) {
          throw new Error("Passing Validation Run has no evidence");
        }
      }
    });
  });

const readBatchedRows = <A extends object>(
  sql: SqlClient.SqlClient,
  changeIds: readonly string[],
  query: (placeholders: string) => string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows: A[] = [];
    for (let start = 0; start < changeIds.length; start += currentPassingEvidenceBatchSize) {
      const batch = changeIds.slice(start, start + currentPassingEvidenceBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(
        ...(yield* sql.unsafe<A>(
          query(placeholders),
          batch.map((id) => internalChangeId(id, idPrefix)),
        )),
      );
    }
    return rows;
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
