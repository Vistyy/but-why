import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type {
  ActiveCandidateValidationRun,
  CandidateValidationRunRecord,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import { decodeSqliteChangeReviewerConfiguration } from "../change/changeReviewerConfiguration.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import { readCandidateById } from "./sqliteCandidateStorage.js";
import { decodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationDecisions,
  deriveAcceptanceContext,
  readImplementationBlockerPrefix,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export type StoredValidationRunRow = {
  readonly id: number;
  readonly candidateId: number;
  readonly policySnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
  readonly outcome: CandidateValidationRunRecord["outcome"];
  readonly cleanupPending: number;
  readonly cleanupBlockingReason: string | null;
};

export const validationRunReadColumns = `
  id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
  highest_decision_id AS highestDecisionId, highest_blocker_id AS highestBlockerId,
  outcome, cleanup_pending AS cleanupPending, cleanup_blocking_reason AS cleanupBlockingReason
`;

type DecodedValidationRun = {
  readonly record: CandidateValidationRunRecord;
  readonly policySnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
};

const decodeValidationRunRow = (
  row: StoredValidationRunRow,
  policy: CandidateValidationRunRecord["policy"],
  reviewerConfiguration: CandidateValidationRunRecord["reviewerConfiguration"],
  implementationDecisions: CandidateValidationRunRecord["implementationDecisions"],
): DecodedValidationRun => {
  if (
    row.outcome !== null &&
    row.outcome !== "passed" &&
    row.outcome !== "blocked" &&
    row.outcome !== "tooling_failed"
  ) {
    throw new Error("Validation Run outcome is unsupported");
  }
  if (row.cleanupPending !== 0 && row.cleanupPending !== 1) {
    throw new Error("Validation Run cleanup obligation is unsupported");
  }
  if (
    (row.cleanupPending === 0 && row.cleanupBlockingReason !== null) ||
    (row.outcome !== null && row.cleanupPending === 1)
  ) {
    throw new Error("Validation Run cleanup relationship is invalid");
  }
  return {
    record: {
      id: row.id,
      candidateId: row.candidateId,
      policy,
      reviewerConfiguration,
      implementationDecisions,
      state: row.outcome === null ? "running" : "complete",
      outcome: row.outcome,
      cleanup: {
        state: row.cleanupPending === 0 ? "complete" : "pending",
        blockingReason: row.cleanupBlockingReason,
      },
    },
    policySnapshot: row.policySnapshot,
    highestDecisionId: row.highestDecisionId,
    highestBlockerId: row.highestBlockerId,
  };
};

export const readValidationRunById = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns} FROM validation_runs WHERE id = ?`,
      [validationRunId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    if (row.id !== validationRunId) {
      return yield* invalidData(operationName, "Validation Run identity does not match lookup");
    }
    const candidate = yield* readCandidateById(sql, row.candidateId, operationName, idPrefix);
    if (candidate === undefined) {
      return yield* invalidData(operationName, "Validation Run belongs to an unknown Candidate");
    }
    const decisions = yield* readDecisionSnapshot(
      sql,
      candidate.changeId,
      row.highestDecisionId,
      operationName,
      idPrefix,
    );
    const blockers = yield* readImplementationBlockerPrefix(
      sql,
      candidate.changeId,
      row.highestBlockerId,
      operationName,
      idPrefix,
    );
    if (blockers.active !== null) {
      return yield* invalidData(
        operationName,
        "Validation Run includes an unresolved Implementation Blocker",
      );
    }
    const changeRows = yield* sql<{
      readonly acceptanceContext: string | null;
      readonly reviewerConfiguration: string;
    }>`
      SELECT initial_acceptance_context AS acceptanceContext,
        reviewer_configuration AS reviewerConfiguration
      FROM changes WHERE id = ${internalChangeId(candidate.changeId, idPrefix)}
    `;
    return yield* decodePersisted(operationName, () => {
      const change = changeRows[0];
      if (change === undefined) throw new Error("Validation Run owning Change was not selected");
      const policy = decodeSqliteCandidateValidationPolicy(row.policySnapshot);
      const initialContext =
        change.acceptanceContext === null
          ? null
          : decodeSqliteAcceptanceContextSnapshot(change.acceptanceContext);
      const expectedContext = deriveAcceptanceContext(initialContext, blockers);
      const policyContext = policy.acceptanceContext ?? null;
      if (
        (expectedContext === null) !== (policyContext === null) ||
        (expectedContext !== null &&
          policyContext !== null &&
          encodeSqliteAcceptanceContextSnapshot(expectedContext) !==
            encodeSqliteAcceptanceContextSnapshot(policyContext))
      ) {
        throw new Error("Validation Run Acceptance Context does not match its Change authority");
      }
      const reviewerConfiguration = decodeSqliteChangeReviewerConfiguration(
        change.reviewerConfiguration,
      );
      return decodeValidationRunRow(row, policy, reviewerConfiguration, decisions).record;
    });
  });

export const readActiveValidationRunForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly validationRunId: number;
      readonly changeId: number;
    }>`
      SELECT run.id AS validationRunId, candidate.change_id AS changeId
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${internalChangeId(changeId, idPrefix)}
        AND run.outcome IS NULL
      ORDER BY run.id DESC
    `;
    if (rows.length > 1) {
      return yield* invalidData(operationName, "Change has more than one active Validation Run");
    }
    const row = rows[0];
    if (row === undefined) return undefined;
    if (publicChangeId(idPrefix, row.changeId) !== changeId) {
      return yield* invalidData(operationName, "Active Validation Run belongs to another Change");
    }
    return {
      validationRunId: row.validationRunId,
      changeId,
    } satisfies ActiveCandidateValidationRun;
  });

const readDecisionSnapshot = (
  sql: SqlClient.SqlClient,
  changeId: string,
  highestDecisionId: number | null,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    highestDecisionId === null
      ? Effect.succeed([] as readonly StoredImplementationDecisionRow[])
      : sql<StoredImplementationDecisionRow>`
          SELECT id, change_id AS changeId, choice, rationale
          FROM implementation_decisions
          WHERE change_id = ${internalChangeId(changeId, idPrefix)}
            AND id <= ${highestDecisionId}
          ORDER BY id
        `,
    (rows) =>
      decodePersisted(operationName, () => {
        const decisions = decodeImplementationDecisions(rows, changeId, idPrefix);
        if ((decisions.at(-1)?.id ?? null) !== highestDecisionId) {
          throw new Error("Validation Run Decision high-water identity is unknown");
        }
        return decisions;
      }),
  );

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
