import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";
import { decodeSqliteChangePolicy } from "../../changePolicy.js";
import type { ChangePublicationEvidence, CurrentChangeEvidenceQuery } from "../../changePorts.js";
import { latestResolvedBlockerId } from "../../implementationBlocker.js";
import { deriveAcceptanceContext } from "../../validationRun/acceptanceContextSnapshot.js";
import { isValidationRunEligibleForCurrentChangeAuthority } from "../../validationRun/validationRun.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  readImplementationBlockerHistory,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import {
  requireCoherentValidationCompletion,
  validateValidationCompletion,
} from "./sqliteValidationCompletion.js";
import { decodeSqliteValidationInputSnapshot } from "./sqliteValidationInputSnapshot.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

const currentPassingEvidenceOperation = "read current passing Change evidence";
const completedPublicationEvidenceOperation = "read completed Candidate Publication evidence";
const currentPassingEvidenceBatchSize = 500;

type CurrentChangeActivityEvidence = {
  readonly hasActiveValidation: boolean;
  readonly currentPassingEvidence?: ChangePublicationEvidence;
};

type StoredCurrentCandidateRow = StoredCandidateRow & {
  readonly validationRunId: number;
  readonly validationInputSnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
  readonly cleanupPending: number;
  readonly cleanupBlockingReason: string | null;
  readonly acceptanceContext: string | null;
  readonly reviewerConfiguration: string;
  readonly prepareDefinition: string | null;
  readonly checksDefinition: string;
};

type StoredValidationEvidenceRow = {
  readonly validationRunId: number;
  readonly phase: string;
  readonly producer: string;
  readonly outcome: string;
  readonly findings: string;
  readonly artifacts: string;
  readonly toolingFailure: string | null;
};

type StoredValidationRunCompletionRow = {
  readonly id: number;
  readonly runToolingFailure: string | null;
};

type StoredReviewerInvocationRow = {
  readonly validationRunId: number;
  readonly invocationId: number;
  readonly phase: string;
  readonly producer: string;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly changeOwned: number;
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
    const evidence = yield* readCurrentPassingValidationEvidenceForChanges(
      sql,
      [changeId],
      idPrefix,
      query,
    );
    return evidence.get(changeId)?.currentPassingEvidence;
  });

export const readCurrentPassingValidationEvidenceForChanges = (
  sql: SqlClient.SqlClient,
  changeIds: readonly string[],
  idPrefix: string,
  query?: CurrentChangeEvidenceQuery,
  options: { readonly excludeActiveValidation?: boolean } = {},
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
        });
      }
    });

    const passingChangeIds = requestedChangeIds.filter(
      (changeId) =>
        options.excludeActiveValidation !== true || !activity.get(changeId)?.hasActiveValidation,
    );
    const candidateRows = yield* readBatchedRows<StoredCurrentCandidateRow>(
      sql,
      passingChangeIds,
      (placeholders) => `
        SELECT ${candidateReadColumns}, passing.id AS validationRunId,
          passing.validation_input_snapshot AS validationInputSnapshot,
          passing.highest_decision_id AS highestDecisionId,
          passing.highest_blocker_id AS highestBlockerId,
          passing.cleanup_pending AS cleanupPending,
          passing.cleanup_blocking_reason AS cleanupBlockingReason,
          changes.initial_acceptance_context AS acceptanceContext,
          changes.reviewer_configuration AS reviewerConfiguration,
          changes.prepare_definition AS prepareDefinition,
          changes.checks_definition AS checksDefinition
        FROM candidates AS candidate
        JOIN changes ON changes.id = candidate.change_id
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
              ${query?.validationRunId === undefined ? "" : "AND latestPassing.id = ?"}
          )
        ORDER BY candidate.id DESC`,
      idPrefix,
      query?.validationRunId === undefined ? [] : [query.validationRunId],
    );
    const candidateRowsMatchingQuery = candidateRows.filter(
      (row) =>
        (query?.candidateId === undefined || row.id === query.candidateId) &&
        (query?.changeBaseSha === undefined || row.changeBaseSha === query.changeBaseSha) &&
        (query?.validationRunId === undefined || row.validationRunId === query.validationRunId),
    );
    const candidates = yield* decodePersisted(currentPassingEvidenceOperation, () =>
      candidateRowsMatchingQuery.map((row) => decodeCandidate(row, idPrefix)),
    );
    const eligibleCandidateIds = yield* validateSelectedPassingEvidence(
      sql,
      candidateRowsMatchingQuery,
      idPrefix,
    );
    const rowsByCandidateId = new Map(candidateRowsMatchingQuery.map((row) => [row.id, row]));
    for (const candidate of candidates) {
      if (!eligibleCandidateIds.has(candidate.id)) continue;
      const row = rowsByCandidateId.get(candidate.id);
      if (row === undefined) throw new Error("Passing Candidate row was not selected");
      activity.set(candidate.changeId, {
        hasActiveValidation: activity.get(candidate.changeId)?.hasActiveValidation ?? false,
        currentPassingEvidence: {
          candidateId: candidate.id,
          validationRunId: row.validationRunId,
          changeBaseSha: candidate.changeBaseSha,
          headSha: candidate.headSha,
        },
      });
    }
    return activity;
  });

const validateSelectedPassingEvidence = (
  sql: SqlClient.SqlClient,
  candidateRows: readonly StoredCurrentCandidateRow[],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const runIds = [...new Set(candidateRows.map((row) => row.validationRunId))];
    const rows: StoredValidationEvidenceRow[] = [];
    const completionRows: StoredValidationRunCompletionRow[] = [];
    const invocationRows: StoredReviewerInvocationRow[] = [];
    for (let start = 0; start < runIds.length; start += currentPassingEvidenceBatchSize) {
      const batch = runIds.slice(start, start + currentPassingEvidenceBatchSize);
      rows.push(
        ...(yield* sql.unsafe<StoredValidationEvidenceRow>(
          `SELECT validation_run_id AS validationRunId, phase, producer, outcome,
              findings, artifacts, tooling_failure AS toolingFailure
           FROM validation_phase_results
           WHERE validation_run_id IN (${batch.map(() => "?").join(", ")})`,
          batch,
        )),
      );
      completionRows.push(
        ...(yield* sql.unsafe<StoredValidationRunCompletionRow>(
          `SELECT id, run_tooling_failure AS runToolingFailure
           FROM validation_runs WHERE id IN (${batch.map(() => "?").join(", ")})`,
          batch,
        )),
      );
      invocationRows.push(
        ...(yield* sql.unsafe<StoredReviewerInvocationRow>(
          `SELECT link.validation_run_id AS validationRunId, link.agent_invocation_id AS invocationId,
              link.phase, link.producer,
              invocation.settled_at AS settledAt, invocation.settlement_kind AS settlementKind,
              CASE WHEN change_session.agent_session_id IS NULL THEN 0 ELSE 1 END AS changeOwned
           FROM validation_phase_agent_invocations AS link
           JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
           JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
           JOIN validation_runs AS run ON run.id = link.validation_run_id
           JOIN candidates AS candidate ON candidate.id = run.candidate_id
           LEFT JOIN change_agent_sessions AS change_session
             ON change_session.change_id = candidate.change_id
             AND change_session.producer = link.producer
             AND change_session.agent_session_id = continuation.agent_session_id
           WHERE link.validation_run_id IN (${batch.map(() => "?").join(", ")})
           ORDER BY link.phase, link.producer, link.agent_invocation_id`,
          batch,
        )),
      );
    }
    const changeIds = [
      ...new Set(candidateRows.map((row) => publicChangeId(idPrefix, row.changeId))),
    ];
    const blockerRows = yield* readBatchedRows<StoredImplementationBlockerRow>(
      sql,
      changeIds,
      (placeholders) => `
        SELECT ${implementationBlockerReadColumns}
        FROM implementation_blockers
        WHERE change_id IN (${placeholders})
        ORDER BY id`,
      idPrefix,
    );
    const decisionRows = yield* readBatchedRows<StoredImplementationDecisionRow>(
      sql,
      changeIds,
      (placeholders) => `
        SELECT id, change_id AS changeId, choice, rationale
        FROM implementation_decisions
        WHERE change_id IN (${placeholders})
        ORDER BY id`,
      idPrefix,
    );
    const eligibleCandidateIds = new Set<number>();
    yield* decodePersisted(currentPassingEvidenceOperation, () => {
      const rowsByRun = new Map<number, StoredValidationEvidenceRow[]>();
      const blockersByChange = new Map<number, StoredImplementationBlockerRow[]>();
      for (const row of blockerRows) {
        const current = blockersByChange.get(row.changeId) ?? [];
        current.push(row);
        blockersByChange.set(row.changeId, current);
      }
      const decisionsByChange = new Map<number, StoredImplementationDecisionRow[]>();
      for (const row of decisionRows) {
        const current = decisionsByChange.get(row.changeId) ?? [];
        current.push(row);
        decisionsByChange.set(row.changeId, current);
      }
      const completionByRun = new Map(completionRows.map((row) => [row.id, row]));
      const invocationsByRun = new Map<number, StoredReviewerInvocationRow[]>();
      for (const row of invocationRows) {
        const current = invocationsByRun.get(row.validationRunId) ?? [];
        current.push(row);
        invocationsByRun.set(row.validationRunId, current);
      }
      for (const row of rows) {
        const current = rowsByRun.get(row.validationRunId) ?? [];
        current.push(row);
        rowsByRun.set(row.validationRunId, current);
      }
      for (const candidate of candidateRows) {
        if (candidate.cleanupPending !== 0 || candidate.cleanupBlockingReason !== null) {
          throw new Error("Passing Validation Run cleanup relationship is invalid");
        }
        const validationInput = decodeSqliteValidationInputSnapshot(
          candidate.validationInputSnapshot,
        );
        const initialContext =
          candidate.acceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(candidate.acceptanceContext);
        const changeId = publicChangeId(idPrefix, candidate.changeId);
        const blockers = blockersByChange.get(candidate.changeId) ?? [];
        const blockerHistory = decodeImplementationBlockerHistory(blockers, changeId, idPrefix);
        const highestBlockerId = candidate.highestBlockerId;
        const blockerPrefix =
          highestBlockerId === null ? [] : blockers.filter((row) => row.id <= highestBlockerId);
        const authorityBlockers = decodeImplementationBlockerHistory(
          blockerPrefix,
          changeId,
          idPrefix,
        );
        if (
          (authorityBlockers.blockers.at(-1)?.id ?? null) !== highestBlockerId ||
          authorityBlockers.active !== null
        ) {
          throw new Error("Validation Run Blocker authority is invalid");
        }
        const decisions = decodeImplementationDecisions(
          (decisionsByChange.get(candidate.changeId) ?? []).filter(
            (row) => candidate.highestDecisionId !== null && row.id <= candidate.highestDecisionId,
          ),
          changeId,
          idPrefix,
        );
        if ((decisions.at(-1)?.id ?? null) !== candidate.highestDecisionId) {
          throw new Error("Validation Run Decision authority is invalid");
        }
        const expectedContext = deriveAcceptanceContext(initialContext, authorityBlockers);
        const actualContext = validationInput.acceptanceContext ?? null;
        if (
          (expectedContext === null) !== (actualContext === null) ||
          (expectedContext !== null &&
            actualContext !== null &&
            encodeSqliteAcceptanceContextSnapshot(expectedContext) !==
              encodeSqliteAcceptanceContextSnapshot(actualContext))
        ) {
          throw new Error("Validation Run Acceptance Context does not match its Change authority");
        }
        if (
          initialContext === null &&
          latestResolvedBlockerId(blockerHistory) !== candidate.highestBlockerId
        ) {
          continue;
        }
        const evidence = rowsByRun.get(candidate.validationRunId);
        const completion = completionByRun.get(candidate.validationRunId);
        if (evidence === undefined || completion === undefined) {
          throw new Error("Passing Validation Run has no evidence");
        }
        validateValidationCompletion(
          decodeSqliteChangePolicy(candidate),
          "passed",
          evidence,
          invocationsByRun.get(candidate.validationRunId) ?? [],
          completion.runToolingFailure,
          candidate.validationRunId,
        );
        eligibleCandidateIds.add(candidate.id);
      }
    });
    return eligibleCandidateIds;
  });

const readBatchedRows = <A extends object>(
  sql: SqlClient.SqlClient,
  changeIds: readonly string[],
  query: (placeholders: string) => string,
  idPrefix: string,
  additionalParameters: readonly unknown[] = [],
) =>
  Effect.gen(function* () {
    const rows: A[] = [];
    for (let start = 0; start < changeIds.length; start += currentPassingEvidenceBatchSize) {
      const batch = changeIds.slice(start, start + currentPassingEvidenceBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(
        ...(yield* sql.unsafe<A>(query(placeholders), [
          ...batch.map((id) => internalChangeId(id, idPrefix)),
          ...additionalParameters,
        ])),
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
