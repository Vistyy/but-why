import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import {
  decodeSqliteCandidateValidationPolicy,
  encodeSqliteCandidateValidationPolicy,
} from "./sqliteCandidateValidationPolicy.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { queryAll, queryOne } from "./query.js";
import { recordValidationEvidenceMutation } from "./sqliteValidationEvidence.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationRunStore,
  CandidateValidationToolingFailure,
  CompleteCandidateValidationRunInput,
  RecordCandidateToolingFailureInput,
  RecordCandidateWorkspaceSetupInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../candidateValidation/candidateValidationRunStore.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { RecordValidationRunCommandRoundInput } from "../validationRun/validationRunStore.js";

export const openSqliteCandidateValidationRunStore = (
  input: SqliteStoreInput,
): CandidateValidationRunStore => ({
  startOrReuse: (runInput) =>
    withStateDatabase(input, (database) => startOrReuse(database, runInput)),
  complete: (runInput) => withStateDatabase(input, (database) => complete(database, runInput)),
  getRunById: (validationRunId) =>
    withStateDatabase(input, (database) => getRunById(database, validationRunId)),
  recordWorkspaceSetup: (setup) =>
    withStateDatabase(input, (database) => recordWorkspaceSetup(database, setup)),
  recordToolingFailure: (failure) =>
    withStateDatabase(input, (database) => recordToolingFailure(database, failure)),
  recordPrepareRound: (round) =>
    withStateDatabase(input, (database) =>
      recordRound(database, {
        ...round,
        phase: validationPhase.prepare,
        producer: "prepare",
      }),
    ),
  recordCheckRound: (round) =>
    withStateDatabase(input, (database) =>
      recordRound(database, { ...round, phase: validationPhase.checks }),
    ),
  recordAcceptanceRound: (round) =>
    withStateDatabase(input, (database) =>
      recordRound(database, {
        ...round,
        phase: validationPhase.acceptanceReview,
        producer: "acceptance",
      }),
    ),
  recordSpecialistRound: (round) =>
    withStateDatabase(input, (database) =>
      recordRound(database, { ...round, phase: validationPhase.specialistReview }),
    ),
  listRounds: (validationRunId) =>
    withStateDatabase(input, (database) => listRounds(database, validationRunId)),
  listFindings: (validationRunId) =>
    withStateDatabase(input, (database) => listFindings(database, validationRunId)),
  listToolingFailures: (validationRunId) =>
    withStateDatabase(input, (database) => listToolingFailures(database, validationRunId)),
  listArtifacts: (validationRunId) =>
    withStateDatabase(input, (database) => listArtifacts(database, validationRunId)),
});

const startOrReuse = (
  database: DatabaseSync,
  input: StartCandidateValidationRunInput,
): StartCandidateValidationRunResult => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const candidate = database
      .prepare(
        "SELECT head_sha AS headSha, comparison_base_sha AS comparisonBaseSha FROM candidates WHERE id = ?",
      )
      .get(input.candidateId) as
      | { readonly headSha: string; readonly comparisonBaseSha: string }
      | undefined;
    if (
      candidate === undefined ||
      candidate.headSha !== input.headSha ||
      (input.comparisonBaseSha !== undefined &&
        candidate.comparisonBaseSha !== input.comparisonBaseSha)
    ) {
      throw new Error("Candidate validation requires the exact stored Candidate identity.");
    }
    const policySnapshot = encodeSqliteCandidateValidationPolicy(input.policy);
    const reusable = database
      .prepare(
        `SELECT id FROM candidate_validation_runs WHERE candidate_id = ? AND policy_snapshot = ? AND outcome = 'passed' LIMIT 1`,
      )
      .get(input.candidateId, policySnapshot) as { readonly id: string } | undefined;
    if (reusable !== undefined) {
      database.exec("COMMIT");
      return { reused: true, validationRunId: reusable.id, outcome: "passed" };
    }
    const validationRunId = randomUUID();
    database
      .prepare(
        `INSERT INTO candidate_validation_runs (id, candidate_id, policy_snapshot, state, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(validationRunId, input.candidateId, policySnapshot, input.now, input.now);
    database.exec("COMMIT");
    return { reused: false, validationRunId };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const getRunById = (
  database: DatabaseSync,
  validationRunId: string,
): CandidateValidationRunRecord | undefined => {
  const row = queryOne<CandidateValidationRunRow>(
    database,
    `SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
            state, outcome, created_at AS createdAt, updated_at AS updatedAt
     FROM candidate_validation_runs
     WHERE id = ?`,
    [validationRunId],
  );

  return row === undefined
    ? undefined
    : { ...row, policy: decodeSqliteCandidateValidationPolicy(row.policySnapshot) };
};

type CandidateValidationRunRow = Omit<CandidateValidationRunRecord, "policy"> & {
  readonly policySnapshot: string;
};

const complete = (database: DatabaseSync, input: CompleteCandidateValidationRunInput): void => {
  database
    .prepare(
      "UPDATE candidate_validation_runs SET state = 'complete', outcome = ?, updated_at = ? WHERE id = ?",
    )
    .run(input.outcome, input.now, input.validationRunId);
};

const recordWorkspaceSetup = (
  database: DatabaseSync,
  input: RecordCandidateWorkspaceSetupInput,
): void => {
  database
    .prepare(
      `INSERT INTO candidate_validation_workspace_setups (validation_run_id, temp_ref_name, submitted_sha, worktree_head, cleanup_worktree, cleanup_temp_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.validationRunId,
      input.tempRefName,
      input.submittedSha,
      input.worktreeHead,
      input.cleanupWorktree,
      input.cleanupTempRef,
      input.now,
    );
};

const recordToolingFailure = (
  database: DatabaseSync,
  input: RecordCandidateToolingFailureInput,
): void => {
  database
    .prepare(
      `INSERT INTO candidate_validation_tooling_failures (validation_run_id, error_kind, operation_name, error_message, created_at) VALUES (?, ?, ?, ?, ? )`,
    )
    .run(
      input.validationRunId,
      input.errorKind,
      input.operationName,
      input.errorMessage,
      input.now,
    );
};

const recordRound = (database: DatabaseSync, input: RecordValidationRunCommandRoundInput): void => {
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO candidate_validation_rounds (validation_run_id, phase, producer, round_number, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.validationRunId,
        input.phase,
        input.producer,
        input.roundNumber,
        input.roundStatus,
        input.now,
      );
    recordValidationEvidenceMutation(database, input, {
      artifacts: "candidate_validation_artifacts",
      findings: "candidate_validation_findings",
    });
    for (const artifact of input.artifactRecords) {
      database
        .prepare(
          `UPDATE candidate_validation_artifacts
           SET original_bytes = ?, stored_bytes = ?, truncated = ?
           WHERE ref = ?`,
        )
        .run(
          artifact.originalBytes ?? 0,
          artifact.storedBytes ?? 0,
          artifact.truncated === true ? 1 : 0,
          artifact.ref,
        );
    }
    database.exec("COMMIT");
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const phaseOrderSql =
  "CASE phase WHEN 'prepare' THEN 0 WHEN 'checks' THEN 1 WHEN 'acceptance_review' THEN 2 ELSE 3 END";

const listRounds = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationRound[] =>
  queryAll<CandidateValidationRound>(
    database,
    `SELECT validation_run_id AS validationRunId, phase, producer,
            round_number AS roundNumber, status, created_at AS createdAt
     FROM candidate_validation_rounds
     WHERE validation_run_id = ?
     ORDER BY ${phaseOrderSql}, round_number, producer`,
    [validationRunId],
  );

const listFindings = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationFinding[] =>
  queryAll<CandidateValidationFindingRow>(
    database,
    `SELECT id, validation_run_id AS validationRunId, phase, producer, title,
            description, severity, evidence, files, artifact_refs AS artifactRefs,
            created_at AS createdAt, updated_at AS updatedAt
     FROM candidate_validation_findings AS finding
     WHERE validation_run_id = ?
     ORDER BY ${phaseOrderSql},
       COALESCE((
         SELECT round_number
         FROM candidate_validation_rounds AS round
         WHERE round.validation_run_id = finding.validation_run_id
           AND round.phase = finding.phase
           AND round.producer = finding.producer
         LIMIT 1
       ), 0),
       id`,
    [validationRunId],
  ).map(({ severity, files, artifactRefs, ...finding }) => ({
    ...finding,
    ...(severity === null ? {} : { severity }),
    files: decodeSqliteJsonStringArray(files),
    artifactRefs: decodeSqliteJsonStringArray(artifactRefs),
  }));

type CandidateValidationFindingRow = Omit<
  CandidateValidationFinding,
  "severity" | "files" | "artifactRefs"
> & {
  readonly severity: Exclude<CandidateValidationFinding["severity"], undefined> | null;
  readonly files: string;
  readonly artifactRefs: string;
};

const listToolingFailures = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationToolingFailure[] =>
  queryAll<CandidateValidationToolingFailure>(
    database,
    `SELECT sequence, validation_run_id AS validationRunId, error_kind AS errorKind,
            operation_name AS operationName, error_message AS errorMessage,
            created_at AS createdAt
     FROM candidate_validation_tooling_failures
     WHERE validation_run_id = ?
     ORDER BY sequence`,
    [validationRunId],
  );

const listArtifacts = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationArtifact[] =>
  queryAll<CandidateValidationArtifactRow>(
    database,
    `SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
            original_bytes AS originalBytes, stored_bytes AS storedBytes, truncated,
            created_at AS createdAt
     FROM candidate_validation_artifacts
     WHERE validation_run_id = ?
     ORDER BY ${phaseOrderSql}, producer,
       CASE
         WHEN path LIKE '%/stdout.txt' THEN 0
         WHEN path LIKE '%/stderr.txt' THEN 1
         WHEN path LIKE '%/exit-code.json' THEN 2
         WHEN path LIKE '%/logs.txt' THEN 3
         ELSE 4
       END,
       ref`,
    [validationRunId],
  ).map((artifact) => ({ ...artifact, truncated: artifact.truncated === 1 }));

type CandidateValidationArtifactRow = Omit<CandidateValidationArtifact, "truncated"> & {
  readonly truncated: number;
};
