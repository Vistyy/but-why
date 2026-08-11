import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import type { ChangeValidationReadPort } from "../change/validation/changeValidationPorts.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";

import {
  candidateReadColumns,
  decodeCandidate,
  decodeToolingFailure,
  decodeValidationArtifact,
  decodeValidationFinding,
  decodeValidationRound,
  decodeValidationRun,
  findingReadColumns,
  type StoredCandidateRow,
  type StoredToolingFailureRow,
  type StoredValidationArtifactRow,
  type StoredValidationFindingRow,
  type StoredValidationRoundRow,
  type StoredValidationRunRow,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
  validationRunReadColumns,
} from "./sqliteCandidateValidationReadModel.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type StoredImplementationBlockerRow,
} from "./sqliteChangeReadModel.js";

import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeValidationReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeValidationReadPort => ({
      getCandidateById: (candidateId) =>
        repository.transaction("read Candidate for validation history", (sql) =>
          readCandidateById(sql, candidateId, "read Candidate for validation history"),
        ),
      getCurrentCandidateForChange: (changeId) =>
        repository.transaction("read current Candidate", (sql) =>
          readCurrentCandidateForChange(sql, changeId),
        ),
      listCandidatesForChange: (changeId) =>
        repository.transaction("list Candidates for validation history", (sql) =>
          readCandidatesForChange(sql, changeId, "list Candidates for validation history"),
        ),
      getRunById: (validationRunId) =>
        repository.transaction("read Candidate Validation Run", (sql) =>
          getRunById(sql, validationRunId),
        ),
      getLatestRunForCandidate: (candidateId) =>
        repository.transaction("read latest Candidate Validation Run", (sql) =>
          getLatestRunForCandidate(sql, candidateId),
        ),
      listRunsForCandidate: (candidateId) =>
        repository.transaction("list Candidate Validation Runs", (sql) =>
          listRunsForCandidate(sql, candidateId),
        ),
      listRounds: (validationRunId) =>
        repository.transaction("list Candidate validation rounds", (sql) =>
          listRounds(sql, validationRunId),
        ),
      listFindings: (validationRunId) =>
        repository.transaction("list Candidate validation Findings", (sql) =>
          listFindings(sql, validationRunId),
        ),
      listToolingFailures: (validationRunId) =>
        repository.transaction("list Candidate validation Tooling Failures", (sql) =>
          listToolingFailures(sql, validationRunId),
        ),
      listArtifacts: (validationRunId) =>
        repository.transaction("list Candidate validation Artifacts", (sql) =>
          listArtifacts(sql, validationRunId),
        ),
    }),
  );

type CandidateOwnerRow = StoredCandidateRow & { readonly storedChangeId: string | null };

const decodeOwnedCandidate = (
  row: CandidateOwnerRow,
  expectedChangeId?: string,
): CandidateRecord => {
  const candidate = decodeCandidate(row);
  const storedChangeId = row.storedChangeId;
  if (
    candidate.changeId !== storedChangeId ||
    (expectedChangeId !== undefined && candidate.changeId !== expectedChangeId)
  ) {
    throw new Error("Candidate belongs to another or unknown Change");
  }
  return candidate;
};

const readCandidateById = (sql: SqlClient.SqlClient, candidateId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.id = ?`,
      [candidateId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const candidate = decodeOwnedCandidate(row);
      if (candidate.id !== candidateId) throw new Error("Candidate identity does not match lookup");
      return candidate;
    });
  });

const readCurrentCandidateForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.change_id = ?
       ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1`,
      [changeId],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted("read current Candidate", () => decodeOwnedCandidate(row, changeId));
  });

const readCandidatesForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.change_id = ?`,
      [changeId],
    );
    return yield* decodePersisted(operationName, () =>
      rows.map((row) => decodeOwnedCandidate(row, changeId)).sort(compareCandidatesAscending),
    );
  });

// Artifact Content cleanup needs only exact Candidate and Validation Run identities.
// This read validates those relationships without decoding opaque historical Snapshots.

const getRunById = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs WHERE id = ?`,
      [validationRunId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted("decode Candidate Validation Run", () => {
      const run = decodeValidationRun(row);
      if (run.record.id !== validationRunId)
        throw new Error("Validation Run identity does not match lookup");
      return run;
    });
    const candidate = yield* readCandidateById(
      sql,
      decoded.record.candidateId,
      "decode Candidate Validation Run",
    );
    if (candidate === undefined) {
      return yield* invalidData(
        "decode Candidate Validation Run",
        "Validation Run belongs to an unknown Candidate",
      );
    }
    yield* validateSelectedValidationRunAuthority(
      sql,
      decoded,
      candidate.changeId,
      "decode Candidate Validation Run",
    );
    return decoded.record;
  });

const getLatestRunForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs
      WHERE candidate_id = ${candidateId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const validationRunId = row.id;
    const run = yield* getRunById(sql, validationRunId);
    if (run === undefined || run.candidateId !== candidateId) {
      return yield* invalidData(
        "read latest Candidate Validation Run",
        "Latest Validation Run belongs to another or unknown Candidate",
      );
    }
    return run;
  });

const requireRun = (sql: SqlClient.SqlClient, validationRunId: string, operationName: string) =>
  Effect.flatMap(getRunById(sql, validationRunId), (run) =>
    run === undefined
      ? invalidData(operationName, "Validation evidence belongs to an unknown Run")
      : Effect.succeed(run),
  );

const requireRunIdentity = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  operationName: string,
  missingMessage: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs WHERE id = ${validationRunId}
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData(operationName, missingMessage);
    yield* decodePersisted(operationName, () => {
      const id = row.id;
      if (id !== validationRunId) throw new Error("Validation Run identity does not match lookup");
    });
  });

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ?`,
      [candidateId],
    );
    if (rows.length === 0) return [];
    const candidate = yield* readCandidateById(sql, candidateId, "decode Candidate Validation Run");
    if (candidate === undefined) {
      return yield* invalidData(
        "decode Candidate Validation Run",
        "Validation Run history belongs to an unknown Candidate",
      );
    }
    const decodedRuns = yield* decodePersisted("decode Candidate Validation Run", () =>
      rows.map((row) => {
        const decoded = decodeValidationRun(row);
        if (decoded.record.candidateId !== candidateId)
          throw new Error("Validation Run belongs to another Candidate");
        return decoded;
      }),
    );
    yield* Effect.forEach(
      decodedRuns,
      (run) =>
        validateSelectedValidationRunAuthority(
          sql,
          run,
          candidate.changeId,
          "decode Candidate Validation Run",
        ),
      { discard: true },
    );
    return decodedRuns
      .map(({ record }) => record)
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id),
      );
  });

const listRounds = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredValidationRoundRow>`
      SELECT validation_run_id AS validationRunId, phase, producer,
        round_number AS roundNumber,
        status, created_at AS createdAt
      FROM candidate_validation_rounds
      WHERE validation_run_id = ${validationRunId}
    `;
    const rounds = yield* decodePersisted("list Candidate validation rounds", () =>
      rows
        .map((row) => assertRunOwner(decodeValidationRound(row), validationRunId))
        .sort(compareRounds),
    );
    if (rounds.length === 0) return rounds;
    const run = yield* getRunById(sql, validationRunId);
    if (run === undefined) {
      return yield* invalidData(
        "list Candidate validation rounds",
        "Validation rounds belong to an unknown Run",
      );
    }
    yield* decodePersisted("list Candidate validation rounds", () =>
      validateRoundPolicyRelationships(rounds, new Map([[run.id, run]])),
    );
    return rounds;
  });

const listFindings = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationFindingRow>(
      `SELECT ${findingReadColumns}
       FROM candidate_validation_findings
       WHERE validation_run_id = ?`,
      [validationRunId],
    );
    const findings = yield* decodePersisted("decode Candidate validation Finding", () =>
      rows.map((row) => assertRunOwner(decodeValidationFinding(row), validationRunId)),
    );
    if (findings.length === 0) return findings;
    const run = yield* requireRun(sql, validationRunId, "decode Candidate validation Finding");
    const roundRows = yield* sql<StoredValidationRoundRow>`
      SELECT round.validation_run_id AS validationRunId, round.phase, round.producer,
        round.round_number AS roundNumber,
        round.status, round.created_at AS createdAt
      FROM candidate_validation_rounds AS round
      WHERE round.validation_run_id = ${validationRunId}
        AND EXISTS (
          SELECT 1 FROM candidate_validation_findings AS finding
          WHERE finding.validation_run_id = round.validation_run_id
            AND finding.phase = round.phase AND finding.producer = round.producer
        )
    `;
    const rounds = yield* decodePersisted("decode Candidate validation Finding", () => {
      const selected = roundRows.map((row) =>
        assertRunOwner(decodeValidationRound(row), validationRunId),
      );
      validateRoundPolicyRelationships(selected, new Map([[run.id, run]]));
      validateFindingRoundRelationships(findings, selected);
      return selected;
    });
    return findings.sort((left, right) => compareEvidence(left, right, rounds));
  });

const listToolingFailures = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredToolingFailureRow>`
      SELECT sequence, validation_run_id AS validationRunId, error_kind AS errorKind,
        operation_name AS operationName, error_message AS errorMessage,
        created_at AS createdAt
      FROM candidate_validation_tooling_failures
      WHERE validation_run_id = ${validationRunId}
    `;
    const failures = yield* decodePersisted("list Candidate validation Tooling Failures", () =>
      rows
        .map((row) => assertRunOwner(decodeToolingFailure(row), validationRunId))
        .sort((left, right) => left.sequence - right.sequence),
    );
    if (failures.length === 0) return failures;
    yield* requireRunIdentity(
      sql,
      validationRunId,
      "list Candidate validation Tooling Failures",
      "Tooling Failures belong to an unknown Run",
    );
    return failures;
  });

const listArtifacts = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredValidationArtifactRow>`
      SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
        original_bytes AS originalBytes, stored_bytes AS storedBytes, truncated,
        created_at AS createdAt
      FROM candidate_validation_artifacts
      WHERE validation_run_id = ${validationRunId}
    `;
    const artifacts = yield* decodePersisted("list Candidate validation Artifacts", () =>
      rows
        .map((row) => assertRunOwner(decodeValidationArtifact(row), validationRunId))
        .sort(compareArtifacts),
    );
    if (artifacts.length === 0) return artifacts;
    const run = yield* requireRun(sql, validationRunId, "list Candidate validation Artifacts");
    const roundRows = yield* sql<StoredValidationRoundRow>`
      SELECT round.validation_run_id AS validationRunId, round.phase, round.producer,
        round.round_number AS roundNumber,
        round.status, round.created_at AS createdAt
      FROM candidate_validation_rounds AS round
      WHERE round.validation_run_id = ${validationRunId}
        AND EXISTS (
          SELECT 1 FROM candidate_validation_artifacts AS artifact
          WHERE artifact.validation_run_id = round.validation_run_id
            AND artifact.phase = round.phase AND artifact.producer = round.producer
        )
    `;
    yield* decodePersisted("list Candidate validation Artifacts", () => {
      const rounds = roundRows.map((row) =>
        assertRunOwner(decodeValidationRound(row), validationRunId),
      );
      validateRoundPolicyRelationships(rounds, new Map([[run.id, run]]));
    });
    return artifacts;
  });

const assertRunOwner = <A extends { readonly validationRunId: string }>(
  record: A,
  validationRunId: string,
): A => {
  if (record.validationRunId !== validationRunId)
    throw new Error("Validation evidence belongs to another Run");
  return record;
};

const phaseOrder = (phase: CandidateValidationRound["phase"]): number => {
  switch (phase) {
    case validationPhase.prepare:
      return 0;
    case validationPhase.checks:
      return 1;
    case validationPhase.acceptanceReview:
      return 2;
    case validationPhase.specialistReview:
      return 3;
  }
};

const compareRounds = (left: CandidateValidationRound, right: CandidateValidationRound): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  left.roundNumber - right.roundNumber ||
  compareStrings(left.producer, right.producer);

const validateRoundPolicyRelationships = (
  rounds: readonly CandidateValidationRound[],
  runs: ReadonlyMap<string, CandidateValidationRunRecord>,
): void => {
  for (const round of rounds) {
    const run = runs.get(round.validationRunId);
    if (run === undefined) throw new Error("Validation round belongs to an unknown Run");
    const expectedRoundNumber = configuredRoundNumber(round, run);
    if (expectedRoundNumber === undefined) {
      throw new Error("Validation round is not configured by its Run policy");
    }
    if (round.roundNumber !== expectedRoundNumber) {
      throw new Error("Validation round ordering does not match its Run policy");
    }
  }
};

const configuredRoundNumber = (
  round: CandidateValidationRound,
  run: CandidateValidationRunRecord,
): number | undefined => {
  switch (round.phase) {
    case validationPhase.prepare:
      return run.policy.prepare === undefined ? undefined : 1;
    case validationPhase.checks: {
      const index = run.policy.checks.findIndex((check) => check.id === round.producer);
      return index < 0 ? undefined : index + 1;
    }
    case validationPhase.acceptanceReview:
      return run.policy.acceptanceReview === undefined ? undefined : 1;
    case validationPhase.specialistReview: {
      const index = (run.policy.specialistReviews ?? []).findIndex(
        (specialist) => specialist.id === round.producer,
      );
      return index < 0 ? undefined : index + 1;
    }
  }
};

const compareEvidence = (
  left: CandidateValidationFinding,
  right: CandidateValidationFinding,
  rounds: readonly CandidateValidationRound[],
): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  findingRound(left, rounds) - findingRound(right, rounds) ||
  compareStrings(left.id, right.id);

const validateFindingRoundRelationships = (
  findings: readonly CandidateValidationFinding[],
  rounds: readonly CandidateValidationRound[],
): void => {
  for (const finding of findings) findingRound(finding, rounds);
};

const findingRound = (
  finding: CandidateValidationFinding,
  rounds: readonly CandidateValidationRound[],
): number => {
  const round = rounds.find(
    (candidate) =>
      candidate.validationRunId === finding.validationRunId &&
      candidate.phase === finding.phase &&
      candidate.producer === finding.producer,
  );
  if (round === undefined) throw new Error("Finding has no related Validation round");
  if (round.status !== "failed") throw new Error("Finding belongs to a passed Validation round");
  return round.roundNumber;
};

const artifactPathOrder = (path: string): number => {
  if (path.endsWith("/stdout.txt")) return 0;
  if (path.endsWith("/stderr.txt")) return 1;
  if (path.endsWith("/exit-code.json")) return 2;
  if (path.endsWith("/logs.txt")) return 3;
  return 4;
};

const compareArtifacts = (
  left: CandidateValidationArtifact,
  right: CandidateValidationArtifact,
): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  compareStrings(left.producer, right.producer) ||
  artifactPathOrder(left.path) - artifactPathOrder(right.path) ||
  compareStrings(left.ref, right.ref);

const compareCandidatesAscending = (left: CandidateRecord, right: CandidateRecord): number =>
  compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const validateSelectedValidationRunAuthority = (
  sql: SqlClient.SqlClient,
  run: ReturnType<typeof decodeValidationRun>,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const latestRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ? AND resolved_at IS NOT NULL AND resolved_at <= ?
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      [changeId, run.record.createdAt],
    );
    const latestBlockerId = yield* decodePersisted(operationName, () =>
      latestResolvedBlockerId(decodeImplementationBlockerHistory(latestRows, changeId)),
    );
    yield* decodePersisted(operationName, () => {
      validateValidationRunImplementationDecisionRelationships(run, changeId);
      validateValidationRunLatestResolvedBlockerRelationship(run, latestBlockerId);
    });
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
