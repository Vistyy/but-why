import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import { recordValidationEvidenceMutation } from "./sqliteValidationEvidence.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunStore,
  CompleteCandidateValidationRunInput,
  RecordCandidateToolingFailureInput,
  RecordCandidateWorkspaceSetupInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { RecordValidationRunCommandRoundInput } from "../validationRun/validationRunStore.js";

export const openSqliteCandidateValidationRunStore = (
  input: SqliteStoreInput,
): CandidateValidationRunStore => ({
  startOrReuse: (runInput) =>
    withStateDatabase(input, (database) => startOrReuse(database, runInput)),
  complete: (runInput) => withStateDatabase(input, (database) => complete(database, runInput)),
  recordWorkspaceSetup: (setup) =>
    withStateDatabase(input, (database) => recordWorkspaceSetup(database, setup)),
  recordToolingFailure: (failure) =>
    withStateDatabase(input, (database) => recordToolingFailure(database, failure)),
  recordPrepareRound: (round) =>
    withStateDatabase(input, (database) =>
      recordRound(database, { ...round, phase: "prepare", producer: "prepare" }),
    ),
  recordCheckRound: (round) =>
    withStateDatabase(input, (database) => recordRound(database, { ...round, phase: "checks" })),
  listRounds: (validationRunId) =>
    withStateDatabase(input, (database) => listRounds(database, validationRunId)),
  listFindings: (validationRunId) =>
    withStateDatabase(input, (database) => listFindings(database, validationRunId)),
});

const startOrReuse = (
  database: DatabaseSync,
  input: StartCandidateValidationRunInput,
): StartCandidateValidationRunResult => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const candidate = database
      .prepare("SELECT head_sha AS headSha FROM candidates WHERE id = ?")
      .get(input.candidateId) as { readonly headSha: string } | undefined;
    if (candidate === undefined || candidate.headSha !== input.headSha) {
      throw new Error("Candidate validation requires the exact stored Candidate head.");
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
    database.exec("COMMIT");
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const listRounds = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationRound[] =>
  database
    .prepare(
      "SELECT producer, status FROM candidate_validation_rounds WHERE validation_run_id = ? ORDER BY round_number",
    )
    .all(validationRunId) as CandidateValidationRound[];

const listFindings = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationFinding[] =>
  database
    .prepare(
      "SELECT id, producer FROM candidate_validation_findings WHERE validation_run_id = ? ORDER BY id",
    )
    .all(validationRunId) as CandidateValidationFinding[];
