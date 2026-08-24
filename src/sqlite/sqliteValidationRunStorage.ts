import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type {
  ActiveCandidateValidationRun,
  CandidateValidationRunRecord,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import { type ChangePolicy, decodeSqliteChangePolicy } from "../change/changePolicy.js";
import { deriveAcceptanceContext } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import { readCandidateById } from "./sqliteCandidateStorage.js";
import {
  decodeImplementationDecisions,
  readImplementationBlockerPrefix,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import { decodeSqliteValidationInputSnapshot } from "./sqliteValidationInputSnapshot.js";

export type StoredValidationRunRow = {
  readonly id: number;
  readonly candidateId: number;
  readonly validationInputSnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
  readonly outcome: CandidateValidationRunRecord["outcome"];
  readonly cleanupPending: number;
  readonly cleanupBlockingReason: string | null;
};

export const validationRunReadColumns = `
  id, candidate_id AS candidateId, validation_input_snapshot AS validationInputSnapshot,
  highest_decision_id AS highestDecisionId, highest_blocker_id AS highestBlockerId,
  outcome, cleanup_pending AS cleanupPending, cleanup_blocking_reason AS cleanupBlockingReason
`;

type DecodedValidationRun = {
  readonly record: CandidateValidationRunRecord;
  readonly validationInputSnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
};

const decodeValidationRunRow = (
  row: StoredValidationRunRow,
  validationInput: CandidateValidationRunRecord["validationInput"],
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
      validationInput,
      implementationDecisions,
      state: row.outcome === null ? "running" : "complete",
      outcome: row.outcome,
      cleanup: {
        state: row.cleanupPending === 0 ? "complete" : "pending",
        blockingReason: row.cleanupBlockingReason,
      },
    },
    validationInputSnapshot: row.validationInputSnapshot,
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
    const changeRows = yield* sql<{ readonly acceptanceContext: string | null }>`
      SELECT initial_acceptance_context AS acceptanceContext
      FROM changes WHERE id = ${internalChangeId(candidate.changeId, idPrefix)}
    `;
    return yield* decodePersisted(operationName, () => {
      const change = changeRows[0];
      if (change === undefined) throw new Error("Validation Run owning Change was not selected");
      const validationInput = decodeSqliteValidationInputSnapshot(row.validationInputSnapshot);
      const initialContext =
        change.acceptanceContext === null
          ? null
          : decodeSqliteAcceptanceContextSnapshot(change.acceptanceContext);
      const expectedContext = deriveAcceptanceContext(initialContext, blockers);
      const policyContext = validationInput.acceptanceContext ?? null;
      if (
        (expectedContext === null) !== (policyContext === null) ||
        (expectedContext !== null &&
          policyContext !== null &&
          encodeSqliteAcceptanceContextSnapshot(expectedContext) !==
            encodeSqliteAcceptanceContextSnapshot(policyContext))
      ) {
        throw new Error("Validation Run Acceptance Context does not match its Change authority");
      }
      return decodeValidationRunRow(row, validationInput, decisions).record;
    });
  });

type ValidationExecutionAuthority = {
  readonly run: CandidateValidationRunRecord;
  readonly changePolicy: ChangePolicy;
};

export const readValidationExecutionAuthorityById = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const run = yield* readValidationRunById(sql, validationRunId, operationName, idPrefix);
    if (run === undefined) return undefined;
    const rows = yield* sql<{
      readonly reviewerConfiguration: string;
      readonly stallDetection: string | null;
      readonly prepareDefinition: string | null;
      readonly checksDefinition: string;
    }>`
      SELECT change_row.reviewer_configuration AS reviewerConfiguration,
        change_row.stall_detection_definition AS stallDetection,
        change_row.prepare_definition AS prepareDefinition,
        change_row.checks_definition AS checksDefinition
      FROM validation_runs AS validation_run
      JOIN candidates AS candidate ON candidate.id = validation_run.candidate_id
      JOIN changes AS change_row ON change_row.id = candidate.change_id
      WHERE validation_run.id = ${validationRunId}
    `;
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) throw new Error("Validation Run owning Change was not selected");
      const changePolicy = decodeSqliteChangePolicy({
        reviewerConfiguration: row.reviewerConfiguration,
        ...(row.stallDetection === null ? {} : { stallDetection: row.stallDetection }),
        prepareDefinition: row.prepareDefinition,
        checksDefinition: row.checksDefinition,
      });
      return { run, changePolicy } satisfies ValidationExecutionAuthority;
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
