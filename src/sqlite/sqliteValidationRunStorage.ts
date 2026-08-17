import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";

import type {
  ActiveCandidateValidationRun,
  CandidateValidationRunRecord,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { ImplementationBlockerHistory } from "../change/implementationBlocker.js";
import { implementationDecisionSnapshotSchema } from "../change/implementationDecision.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { readCandidateById } from "./sqliteCandidateStorage.js";
import { decodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type StoredImplementationBlockerRow,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export type StoredValidationRunRow = {
  readonly id: string;
  readonly candidateId: string;
  readonly policySnapshot: string;
  readonly implementationDecisions: string;
  readonly latestResolvedBlockerId: string | null;
  readonly state: CandidateValidationRunRecord["state"];
  readonly outcome: CandidateValidationRunRecord["outcome"];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const validationRunReadColumns = `
  id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
  implementation_decisions AS implementationDecisions,
  latest_resolved_blocker_id AS latestResolvedBlockerId,
  state, outcome, created_at AS createdAt, updated_at AS updatedAt
`;

export type DecodedValidationRun = {
  readonly record: CandidateValidationRunRecord;
  readonly policySnapshot: string;
  readonly implementationDecisionsSnapshot: string;
  readonly latestResolvedBlockerId: string | null;
};

export const decodeValidationRun = (row: StoredValidationRunRow): DecodedValidationRun => {
  const policySnapshot = row.policySnapshot;
  const implementationDecisionsSnapshot = row.implementationDecisions;
  return {
    record: {
      id: row.id,
      candidateId: row.candidateId,
      policy: decodeSqliteCandidateValidationPolicy(policySnapshot),
      implementationDecisions: Schema.decodeUnknownSync(
        Schema.parseJson(implementationDecisionSnapshotSchema),
        { onExcessProperty: "error" },
      )(implementationDecisionsSnapshot),
      state: row.state,
      outcome: row.outcome,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    policySnapshot,
    implementationDecisionsSnapshot,
    latestResolvedBlockerId: row.latestResolvedBlockerId,
  };
};

export const readValidationRunById = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs WHERE id = ?`,
      [validationRunId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted(operationName, () => {
      const run = decodeValidationRun(row);
      if (run.record.id !== validationRunId)
        throw new Error("Validation Run identity does not match lookup");
      return run;
    });
    const candidate = yield* readCandidateById(
      sql,
      decoded.record.candidateId,
      operationName,
      idPrefix,
    );
    if (candidate === undefined) {
      return yield* invalidData(operationName, "Validation Run belongs to an unknown Candidate");
    }
    yield* validateSelectedValidationRunAuthority(
      sql,
      decoded,
      candidate.changeId,
      operationName,
      idPrefix,
    );
    return decoded.record;
  });

type StoredActiveValidationRunRow = {
  readonly validationRunId: string;
  readonly changeId: number;
  readonly runId: string;
  readonly runCandidateId: string;
  readonly runState: CandidateValidationRunRecord["state"];
  readonly runOutcome: string | null;
  readonly candidateId: string;
  readonly candidateChangeId: number;
  readonly storedChangeId: number;
};

export const readActiveValidationRunForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredActiveValidationRunRow>`
      SELECT active.validation_run_id AS validationRunId, active.change_id AS changeId,
        run.id AS runId, run.candidate_id AS runCandidateId,
        run.state AS runState, run.outcome AS runOutcome,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId,
        change_row.id AS storedChangeId
      FROM active_validation_runs AS active
      LEFT JOIN candidate_validation_runs AS run ON run.id = active.validation_run_id
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      WHERE active.change_id = ${internalChangeId(changeId, idPrefix)}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted(operationName, () =>
          decodeActiveValidationRun(row, changeId, idPrefix),
        );
  });

export const validateValidationRunAuthorityRelationships = (
  run: DecodedValidationRun,
  changeId: string,
  blockers: ImplementationBlockerHistory,
): void => {
  const expectedLatestResolvedBlockerId = [...blockers.blockers]
    .filter(
      (blocker): blocker is typeof blocker & { readonly resolvedAt: string } =>
        blocker.resolvedAt !== null && blocker.resolvedAt <= run.record.createdAt,
    )
    .sort(
      (left, right) =>
        compareStrings(right.resolvedAt, left.resolvedAt) || right.sequence - left.sequence,
    )[0]?.id;
  validateValidationRunLatestResolvedBlockerRelationship(
    run,
    expectedLatestResolvedBlockerId ?? null,
  );
  validateValidationRunImplementationDecisionRelationships(run, changeId);
};

export const validateValidationRunLatestResolvedBlockerRelationship = (
  run: DecodedValidationRun,
  expectedLatestResolvedBlockerId: string | null,
): void => {
  if (run.latestResolvedBlockerId !== expectedLatestResolvedBlockerId) {
    throw new Error("Validation Run latest resolved Blocker identity is inconsistent");
  }
};

export const validateValidationRunImplementationDecisionRelationships = (
  run: DecodedValidationRun,
  changeId: string,
): void => {
  const decisionIds = new Set<string>();
  const decisionSequences = new Set<number>();
  let previousSequence = 0;
  for (const decision of run.record.implementationDecisions) {
    if (decision.changeId !== changeId) {
      throw new Error("Validation Run Implementation Decision belongs to another Change");
    }
    if (!Number.isSafeInteger(decision.sequence) || decision.sequence <= 0) {
      throw new Error(
        "Validation Run Implementation Decision sequence must be a positive safe integer",
      );
    }
    if (
      decisionIds.has(decision.id) ||
      decisionSequences.has(decision.sequence) ||
      decision.sequence <= previousSequence
    ) {
      throw new Error("Validation Run Implementation Decision ordering is inconsistent");
    }
    decisionIds.add(decision.id);
    decisionSequences.add(decision.sequence);
    previousSequence = decision.sequence;
  }
};

const decodeActiveValidationRun = (
  row: StoredActiveValidationRunRow,
  expectedChangeId: string,
  idPrefix: string,
): ActiveCandidateValidationRun => {
  if (
    publicChangeId(idPrefix, row.changeId) !== expectedChangeId ||
    row.candidateChangeId !== row.changeId ||
    row.storedChangeId !== row.changeId
  ) {
    throw new Error("Active Validation Run belongs to another or unknown Change");
  }
  if (
    row.runId !== row.validationRunId ||
    row.runCandidateId !== row.candidateId ||
    row.runState !== "running" ||
    row.runOutcome !== null
  ) {
    throw new Error("Active Validation Run relationship is inconsistent");
  }
  return { validationRunId: row.validationRunId, changeId: publicChangeId(idPrefix, row.changeId) };
};

const validateSelectedValidationRunAuthority = (
  sql: SqlClient.SqlClient,
  run: DecodedValidationRun,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const latestRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ? AND resolved_at IS NOT NULL AND resolved_at <= ?
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [internalChangeId(changeId, idPrefix), run.record.createdAt],
    );
    const latestBlockerId = yield* decodePersisted(operationName, () =>
      latestResolvedBlockerId(decodeImplementationBlockerHistory(latestRows, changeId, idPrefix)),
    );
    yield* decodePersisted(operationName, () => {
      validateValidationRunImplementationDecisionRelationships(run, changeId);
      validateValidationRunLatestResolvedBlockerRelationship(run, latestBlockerId);
    });
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
