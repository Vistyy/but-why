import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type {
  ActiveCandidateValidationRun,
  CandidateValidationRunRecord,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { readCandidateById } from "./sqliteCandidateStorage.js";
import { decodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationDecisions,
  readImplementationBlockerPrefix,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export type StoredValidationRunRow = {
  readonly id: number;
  readonly candidateId: number;
  readonly policySnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
  readonly outcome: CandidateValidationRunRecord["outcome"];
};

export const validationRunReadColumns = `
  id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
  highest_decision_id AS highestDecisionId, highest_blocker_id AS highestBlockerId,
  outcome
`;

type DecodedValidationRun = {
  readonly record: CandidateValidationRunRecord;
  readonly policySnapshot: string;
  readonly highestDecisionId: number | null;
  readonly highestBlockerId: number | null;
};

const decodeValidationRunRow = (
  row: StoredValidationRunRow,
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
  return {
    record: {
      id: row.id,
      candidateId: row.candidateId,
      policy: decodeSqliteCandidateValidationPolicy(row.policySnapshot),
      implementationDecisions,
      state: row.outcome === null ? "running" : "complete",
      outcome: row.outcome,
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
    yield* readImplementationBlockerPrefix(
      sql,
      candidate.changeId,
      row.highestBlockerId,
      operationName,
      idPrefix,
    );
    return yield* decodePersisted(
      operationName,
      () => decodeValidationRunRow(row, decisions).record,
    );
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
