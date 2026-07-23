import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";

import type { CandidateRecord } from "../candidate/candidate.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
  RecordCandidateValidationCommandRoundInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../changeValidation/changeValidationPersistence.js";
import { RepositoryPersistedDataInvalid } from "../repositoryStorageError.js";
import { validationPhase } from "../validationRun/validationRun.js";
import {
  decodeSqliteCandidateValidationPolicy,
  encodeSqliteCandidateValidationPolicy,
} from "./sqliteCandidateValidationPolicy.js";
import {
  decodeSqliteJsonStringArray,
  encodeSqliteJsonStringArray,
} from "./sqliteJsonStringArray.js";
import { RepositorySql } from "./repositorySql.js";

export const openSqliteChangeValidationPersistence = (): Effect.Effect<
  ChangeValidationPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    getCandidateById: (candidateId) =>
      repository.operation("read Candidate for validation history", (sql) =>
        getCandidateById(sql, candidateId),
      ),
    listCandidatesForChange: (changeId) =>
      repository.operation("list Candidates for validation history", (sql) =>
        listCandidatesForChange(sql, changeId),
      ),
    startOrReuse: (input) =>
      repository.transactionImmediate("start Candidate Validation Run", (sql) =>
        startOrReuse(sql, input),
      ),
    complete: (input) =>
      repository.operation("complete Candidate Validation Run", (sql) =>
        Effect.asVoid(sql`
          UPDATE candidate_validation_runs
          SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
          WHERE id = ${input.validationRunId}
        `),
      ),
    getRunById: (validationRunId) =>
      repository
        .operation("read Candidate Validation Run", (sql) => getRunById(sql, validationRunId))
        .pipe(Effect.flatMap(decodeRunOptional)),
    listRunsForCandidate: (candidateId) =>
      repository
        .operation("list Candidate Validation Runs", (sql) =>
          listRunsForCandidate(sql, candidateId),
        )
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeRun))),
    recordWorkspaceSetup: (input) =>
      repository.operation("record Candidate validation workspace setup", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO candidate_validation_workspace_setups (
            validation_run_id, temp_ref_name, submitted_sha, worktree_head,
            cleanup_worktree, cleanup_temp_ref, created_at
          ) VALUES (
            ${input.validationRunId}, ${input.tempRefName}, ${input.submittedSha},
            ${input.worktreeHead}, ${input.cleanupWorktree}, ${input.cleanupTempRef}, ${input.now}
          )
        `),
      ),
    recordToolingFailure: (input) =>
      repository.operation("record Candidate validation Tooling Failure", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO candidate_validation_tooling_failures (
            validation_run_id, error_kind, operation_name, error_message, created_at
          ) VALUES (
            ${input.validationRunId}, ${input.errorKind}, ${input.operationName},
            ${input.errorMessage}, ${input.now}
          )
        `),
      ),
    recordPrepareRound: (input) =>
      repository.transactionImmediate("record Candidate validation Prepare round", (sql) =>
        recordRound(sql, {
          ...input,
          phase: validationPhase.prepare,
          producer: "prepare",
        }),
      ),
    recordCheckRound: (input) =>
      repository.transactionImmediate("record Candidate validation Check round", (sql) =>
        recordRound(sql, { ...input, phase: validationPhase.checks }),
      ),
    recordAcceptanceRound: (input) =>
      repository.transactionImmediate("record Candidate Acceptance Review round", (sql) =>
        recordRound(sql, {
          ...input,
          phase: validationPhase.acceptanceReview,
          producer: "acceptance",
        }),
      ),
    recordSpecialistRound: (input) =>
      repository.transactionImmediate("record Candidate Specialist Review round", (sql) =>
        recordRound(sql, { ...input, phase: validationPhase.specialistReview }),
      ),
    listRounds: (validationRunId) =>
      repository.operation("list Candidate validation rounds", (sql) =>
        listRounds(sql, validationRunId),
      ),
    listFindings: (validationRunId) =>
      repository
        .operation("list Candidate validation Findings", (sql) =>
          listFindings(sql, validationRunId),
        )
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeFinding))),
    listPreviousCandidateReviewerFindings: (input) =>
      repository
        .operation("list previous Candidate reviewer Findings", (sql) =>
          listPreviousCandidateReviewerFindings(sql, input),
        )
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeFinding))),
    listToolingFailures: (validationRunId) =>
      repository.operation("list Candidate validation Tooling Failures", (sql) =>
        listToolingFailures(sql, validationRunId),
      ),
    listArtifacts: (validationRunId) =>
      repository
        .operation("list Candidate validation Artifacts", (sql) =>
          listArtifacts(sql, validationRunId),
        )
        .pipe(Effect.map((rows) => rows.map(decodeArtifact))),
  }));

const candidateColumns = `
  id, change_id AS changeId, selected_base_ref AS selectedBaseRef,
  resolved_target_sha AS resolvedTargetSha, comparison_base_sha AS comparisonBaseSha,
  head_sha AS headSha, created_at AS createdAt
`;

const getCandidateById = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.map(
    sql.unsafe<CandidateRecord>(`SELECT ${candidateColumns} FROM candidates WHERE id = ?`, [
      candidateId,
    ]),
    (rows) => rows[0],
  );

const listCandidatesForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  sql.unsafe<CandidateRecord>(
    `SELECT ${candidateColumns}
     FROM candidates
     WHERE change_id = ?
     ORDER BY created_at ASC, id ASC`,
    [changeId],
  );

const startOrReuse = (sql: SqlClient.SqlClient, input: StartCandidateValidationRunInput) =>
  Effect.gen(function* () {
    const candidates = yield* sql<CandidateIdentityRow>`
      SELECT head_sha AS headSha, comparison_base_sha AS comparisonBaseSha
      FROM candidates WHERE id = ${input.candidateId}
    `;
    const candidate = candidates[0];
    if (
      candidate === undefined ||
      candidate.headSha !== input.headSha ||
      (input.comparisonBaseSha !== undefined &&
        candidate.comparisonBaseSha !== input.comparisonBaseSha)
    ) {
      return yield* new RepositoryPersistedDataInvalid({
        operationName: "start Candidate Validation Run",
        cause: new Error("Candidate validation requires the exact stored Candidate identity."),
      });
    }

    const policySnapshot = encodeSqliteCandidateValidationPolicy(input.policy);
    const reusable = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs
      WHERE candidate_id = ${input.candidateId}
        AND policy_snapshot = ${policySnapshot}
        AND outcome = 'passed'
      LIMIT 1
    `;
    const existing = reusable[0];
    if (existing !== undefined) {
      return {
        reused: true,
        validationRunId: existing.id,
        outcome: "passed",
      } satisfies StartCandidateValidationRunResult;
    }

    const validationRunId = randomUUID();
    yield* sql`
      INSERT INTO candidate_validation_runs (
        id, candidate_id, policy_snapshot, state, created_at, updated_at
      ) VALUES (
        ${validationRunId}, ${input.candidateId}, ${policySnapshot}, 'running',
        ${input.now}, ${input.now}
      )
    `;
    return { reused: false, validationRunId } satisfies StartCandidateValidationRunResult;
  });

const getRunById = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.map(
    sql<CandidateValidationRunRow>`
      SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
        state, outcome, created_at AS createdAt, updated_at AS updatedAt
      FROM candidate_validation_runs WHERE id = ${validationRunId}
    `,
    (rows) => rows[0],
  );

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  sql<CandidateValidationRunRow>`
    SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
      state, outcome, created_at AS createdAt, updated_at AS updatedAt
    FROM candidate_validation_runs
    WHERE candidate_id = ${candidateId}
    ORDER BY created_at ASC, id ASC
  `;

const recordRound = (sql: SqlClient.SqlClient, input: RecordCandidateValidationCommandRoundInput) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO candidate_validation_rounds (
        validation_run_id, phase, producer, round_number, status, created_at
      ) VALUES (
        ${input.validationRunId}, ${input.phase}, ${input.producer}, ${input.roundNumber},
        ${input.roundStatus}, ${input.now}
      )
    `;

    yield* Effect.forEach(
      input.artifactRecords,
      (artifact) => sql`
        INSERT INTO candidate_validation_artifacts (
          ref, validation_run_id, phase, producer, path, original_bytes,
          stored_bytes, truncated, created_at
        ) VALUES (
          ${artifact.ref}, ${artifact.validationRunId}, ${artifact.phase}, ${artifact.producer},
          ${artifact.path}, ${artifact.originalBytes ?? 0}, ${artifact.storedBytes ?? 0},
          ${artifact.truncated === true ? 1 : 0}, ${input.now}
        )
      `,
      { discard: true },
    );

    const findings = input.findings ?? (input.finding === undefined ? [] : [input.finding]);
    yield* Effect.forEach(
      findings,
      (finding) => sql`
        INSERT INTO candidate_validation_findings (
          id, validation_run_id, phase, producer, title, description, severity,
          evidence, files, artifact_refs, created_at, updated_at
        ) VALUES (
          ${finding.id}, ${finding.validationRunId}, ${finding.phase}, ${finding.producer},
          ${finding.title}, ${finding.description}, ${finding.severity ?? null},
          ${finding.evidence}, ${encodeSqliteJsonStringArray(finding.files)},
          ${encodeSqliteJsonStringArray(finding.artifactRefs)}, ${input.now}, ${input.now}
        )
      `,
      { discard: true },
    );
  });

const listRounds = (sql: SqlClient.SqlClient, validationRunId: string) =>
  sql<CandidateValidationRound>`
    SELECT validation_run_id AS validationRunId, phase, producer,
      round_number AS roundNumber, status, created_at AS createdAt
    FROM candidate_validation_rounds
    WHERE validation_run_id = ${validationRunId}
    ORDER BY
      CASE phase
        WHEN 'prepare' THEN 0
        WHEN 'checks' THEN 1
        WHEN 'acceptance_review' THEN 2
        ELSE 3
      END,
      round_number, producer
  `;

const findingColumns = `
  id, validation_run_id AS validationRunId, phase, producer, title,
  description, severity, evidence, files, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt
`;

const listFindings = (sql: SqlClient.SqlClient, validationRunId: string) =>
  sql.unsafe<CandidateValidationFindingRow>(
    `SELECT ${findingColumns}
     FROM candidate_validation_findings AS finding
     WHERE validation_run_id = ?
     ORDER BY
       CASE phase
         WHEN 'prepare' THEN 0
         WHEN 'checks' THEN 1
         WHEN 'acceptance_review' THEN 2
         ELSE 3
       END,
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
  );

const listPreviousCandidateReviewerFindings = (
  sql: SqlClient.SqlClient,
  input: {
    readonly candidateId: string;
    readonly phase: CandidateValidationFinding["phase"];
    readonly producer: string;
  },
) =>
  sql.unsafe<CandidateValidationFindingRow>(
    `WITH current_candidate AS (
       SELECT change_id, rowid AS insertion_order
       FROM candidates
       WHERE id = ?
     ), immediately_preceding_candidate AS (
       SELECT candidate.id
       FROM candidates AS candidate
       JOIN current_candidate AS current
         ON current.change_id = candidate.change_id
       WHERE candidate.rowid < current.insertion_order
       ORDER BY candidate.rowid DESC
       LIMIT 1
     ), latest_reviewer_round AS (
       SELECT prior_round.validation_run_id
       FROM candidate_validation_rounds AS prior_round
       JOIN candidate_validation_runs AS prior_run
         ON prior_run.id = prior_round.validation_run_id
       WHERE prior_run.candidate_id = (SELECT id FROM immediately_preceding_candidate)
         AND prior_round.phase = ?
         AND prior_round.producer = ?
       ORDER BY prior_run.created_at DESC, prior_run.id DESC
       LIMIT 1
     )
     SELECT ${findingColumns}
     FROM candidate_validation_findings
     WHERE validation_run_id = (SELECT validation_run_id FROM latest_reviewer_round)
       AND phase = ?
       AND producer = ?
     ORDER BY id`,
    [input.candidateId, input.phase, input.producer, input.phase, input.producer],
  );

const listToolingFailures = (sql: SqlClient.SqlClient, validationRunId: string) =>
  sql<CandidateValidationToolingFailure>`
    SELECT sequence, validation_run_id AS validationRunId, error_kind AS errorKind,
      operation_name AS operationName, error_message AS errorMessage,
      created_at AS createdAt
    FROM candidate_validation_tooling_failures
    WHERE validation_run_id = ${validationRunId}
    ORDER BY sequence
  `;

const listArtifacts = (sql: SqlClient.SqlClient, validationRunId: string) =>
  sql<CandidateValidationArtifactRow>`
    SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
      original_bytes AS originalBytes, stored_bytes AS storedBytes, truncated,
      created_at AS createdAt
    FROM candidate_validation_artifacts
    WHERE validation_run_id = ${validationRunId}
    ORDER BY
      CASE phase
        WHEN 'prepare' THEN 0
        WHEN 'checks' THEN 1
        WHEN 'acceptance_review' THEN 2
        ELSE 3
      END,
      producer,
      CASE
        WHEN path LIKE '%/stdout.txt' THEN 0
        WHEN path LIKE '%/stderr.txt' THEN 1
        WHEN path LIKE '%/exit-code.json' THEN 2
        WHEN path LIKE '%/logs.txt' THEN 3
        ELSE 4
      END,
      ref
  `;

const decodeRunOptional = (row: CandidateValidationRunRow | undefined) =>
  row === undefined ? Effect.succeed(undefined) : decodeRun(row);

const decodeRun = (row: CandidateValidationRunRow) =>
  Effect.try({
    try: (): CandidateValidationRunRecord => ({
      id: row.id,
      candidateId: row.candidateId,
      policy: decodeSqliteCandidateValidationPolicy(row.policySnapshot),
      state: row.state,
      outcome: row.outcome,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Candidate Validation Run",
        cause,
      }),
  });

const decodeFinding = (row: CandidateValidationFindingRow) =>
  Effect.try({
    try: (): CandidateValidationFinding => {
      const { severity, files, artifactRefs, ...finding } = row;
      return {
        ...finding,
        ...(severity === null ? {} : { severity }),
        files: decodeSqliteJsonStringArray(files),
        artifactRefs: decodeSqliteJsonStringArray(artifactRefs),
      };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Candidate validation Finding",
        cause,
      }),
  });

const decodeArtifact = (artifact: CandidateValidationArtifactRow): CandidateValidationArtifact => ({
  ...artifact,
  truncated: artifact.truncated === 1,
});

type CandidateIdentityRow = {
  readonly headSha: string;
  readonly comparisonBaseSha: string;
};
type CandidateValidationRunRow = Omit<CandidateValidationRunRecord, "policy"> & {
  readonly policySnapshot: string;
};
type CandidateValidationFindingRow = Omit<
  CandidateValidationFinding,
  "severity" | "files" | "artifactRefs"
> & {
  readonly severity: Exclude<CandidateValidationFinding["severity"], undefined> | null;
  readonly files: string;
  readonly artifactRefs: string;
};
type CandidateValidationArtifactRow = Omit<CandidateValidationArtifact, "truncated"> & {
  readonly truncated: number;
};
