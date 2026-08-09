import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  ActiveCandidateValidationRun,
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
  RecordCandidateValidationCommandRoundInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { implementationDecisionSnapshotSchema } from "../change/implementationDecision.js";
import type { ChangeValidationPersistence } from "../change/validation/changeValidationPersistence.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeSqliteCandidateValidationPolicy,
  encodeSqliteCandidateValidationPolicy,
} from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type UnknownImplementationBlockerRow,
} from "./sqliteChangeReadModel.js";
import {
  decodeSqliteJsonStringArray,
  encodeSqliteJsonStringArray,
} from "./sqliteJsonStringArray.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

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
    listRunIdsForChange: (changeId) =>
      repository.operation("list Candidate Validation Run IDs", (sql) =>
        listRunIdsForChange(sql, changeId),
      ),
    startOrReuse: (input) =>
      repository.transactionImmediate("start Candidate Validation Run", (sql) =>
        startOrReuse(sql, input),
      ),
    complete: (input) =>
      repository.transactionImmediate("complete Candidate Validation Run", (sql) =>
        complete(sql, input),
      ),
    getActiveForChange: (changeId) =>
      repository
        .operation("read Active Candidate Validation Run", (sql) =>
          getActiveForChange(sql, changeId),
        )
        .pipe(Effect.map((row) => row)),
    getAbandonmentContext: (validationRunId) =>
      repository
        .operation("read Candidate Validation Run abandonment context", (sql) =>
          getAbandonmentContext(sql, validationRunId),
        )
        .pipe(Effect.map((row) => row)),
    abandon: (input) =>
      repository.transactionImmediate("abandon Candidate Validation Run", (sql) =>
        abandon(sql, input),
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
            validation_run_id, temp_ref_name, submitted_sha, worktree_head, worktree_path,
            cleanup_worktree, cleanup_temp_ref, created_at
          ) VALUES (
            ${input.validationRunId}, ${input.tempRefName}, ${input.submittedSha},
            ${input.worktreeHead}, ${input.worktreePath ?? null},
            ${input.cleanupWorktree}, ${input.cleanupTempRef}, ${input.now}
          )
          ON CONFLICT (validation_run_id) DO UPDATE SET
            temp_ref_name = excluded.temp_ref_name,
            submitted_sha = excluded.submitted_sha,
            worktree_head = excluded.worktree_head,
            worktree_path = excluded.worktree_path,
            cleanup_worktree = excluded.cleanup_worktree,
            cleanup_temp_ref = excluded.cleanup_temp_ref,
            created_at = excluded.created_at
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
  id, change_id AS changeId, change_base_sha AS changeBaseSha,
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

// Artifact Content cleanup selects only Validation Run identities through the
// Candidate-to-Change relationship. It never reads or decodes Validation Policy
// or Implementation Decision Snapshots, so an unsupported historical Snapshot
// cannot block Terminal Cleanup while full Run reads stay strict.
const listRunIdsForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  sql<{ readonly id: string }>`
    SELECT run.id
    FROM candidate_validation_runs AS run
    JOIN candidates AS candidate ON candidate.id = run.candidate_id
    WHERE candidate.change_id = ${changeId}
    ORDER BY run.created_at ASC, run.id ASC
  `.pipe(Effect.map((rows) => rows.map((row) => row.id)));

const startOrReuse = (sql: SqlClient.SqlClient, input: StartCandidateValidationRunInput) =>
  Effect.gen(function* () {
    const candidates = yield* sql<CandidateIdentityRow>`
      SELECT head_sha AS headSha, change_base_sha AS changeBaseSha, change_id AS changeId
      FROM candidates WHERE id = ${input.candidateId}
    `;
    const candidate = candidates[0];
    if (
      candidate === undefined ||
      candidate.headSha !== input.headSha ||
      (input.changeBaseSha !== undefined && candidate.changeBaseSha !== input.changeBaseSha)
    ) {
      return yield* new RepositoryPersistedDataInvalid({
        operationName: "start Candidate Validation Run",
        cause: new Error("Candidate validation requires the exact stored Candidate identity."),
      });
    }

    const blockerRows = yield* sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ?`,
      [candidate.changeId],
    );
    const blockerHistory = yield* decodePersisted("start Candidate Validation Run", () =>
      decodeImplementationBlockerHistory(blockerRows, candidate.changeId),
    );
    if (blockerHistory.active !== null) {
      return {
        reused: false,
        blocked: true,
      } satisfies StartCandidateValidationRunResult;
    }
    const currentLatestResolvedBlockerId = latestResolvedBlockerId(blockerHistory);
    const policySnapshot = yield* Effect.try({
      try: () => encodeSqliteCandidateValidationPolicy(input.policy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "start Candidate Validation Run",
          cause,
        }),
    });
    const decisionsSnapshot = JSON.stringify(input.implementationDecisions ?? []);
    const reusable = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs
      WHERE candidate_id = ${input.candidateId}
        AND policy_snapshot = ${policySnapshot}
        AND implementation_decisions = ${decisionsSnapshot}
        AND state = 'complete'
        AND outcome = 'passed'
        AND (
          (latest_resolved_blocker_id IS NULL AND ${currentLatestResolvedBlockerId} IS NULL)
          OR latest_resolved_blocker_id = ${currentLatestResolvedBlockerId}
        )
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

    const validationRunId = input.validationRunId ?? randomUUID();
    const active = yield* sql<{ readonly validationRunId: string }>`
      SELECT validation_run_id AS validationRunId
      FROM active_validation_runs
      WHERE change_id = ${candidate.changeId}
    `;
    if (active[0] !== undefined) {
      return {
        reused: false,
        active: true,
        validationRunId: active[0].validationRunId,
      } satisfies StartCandidateValidationRunResult;
    }

    yield* sql`
      INSERT INTO candidate_validation_runs (
        id, candidate_id, policy_snapshot, implementation_decisions, latest_resolved_blocker_id,
        state, created_at, updated_at
      ) VALUES (
        ${validationRunId}, ${input.candidateId}, ${policySnapshot}, ${decisionsSnapshot},
        ${currentLatestResolvedBlockerId}, 'running', ${input.now}, ${input.now}
      )
    `;
    yield* sql`
      INSERT INTO active_validation_runs (change_id, validation_run_id, created_at)
      VALUES (${candidate.changeId}, ${validationRunId}, ${input.now})
    `;
    if (input.workspaceSetup !== undefined) {
      yield* sql`
        INSERT INTO candidate_validation_workspace_setups (
          validation_run_id, temp_ref_name, submitted_sha, worktree_head, worktree_path,
          cleanup_worktree, cleanup_temp_ref, created_at
        ) VALUES (
          ${validationRunId}, ${input.workspaceSetup.tempRefName}, ${input.headSha}, ${input.headSha},
          ${input.workspaceSetup.worktreePath}, 'not_created', 'not_created', ${input.now}
        )
      `;
    }
    return { reused: false, validationRunId } satisfies StartCandidateValidationRunResult;
  });

const complete = (
  sql: SqlClient.SqlClient,
  input: { readonly validationRunId: string; readonly outcome: string; readonly now: string },
) =>
  Effect.zipRight(
    sql`
      UPDATE candidate_validation_runs
      SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
      WHERE id = ${input.validationRunId}
    `,
    sql`DELETE FROM active_validation_runs WHERE validation_run_id = ${input.validationRunId}`,
  ).pipe(Effect.asVoid);

const getActiveForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.map(
    sql<ActiveCandidateValidationRun>`
      SELECT validation_run_id AS validationRunId, change_id AS changeId
      FROM active_validation_runs
      WHERE change_id = ${changeId}
    `,
    (rows) => rows[0],
  );

const getAbandonmentContext = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.map(
    sql<
      Omit<
        CandidateValidationRunAbandonmentContext,
        "tempRefName" | "worktreePath" | "cleanupWorktree" | "cleanupTempRef"
      > & {
        readonly tempRefName: string | null;
        readonly worktreePath: string | null;
        readonly cleanupWorktree: CandidateValidationRunAbandonmentContext["cleanupWorktree"];
        readonly cleanupTempRef: CandidateValidationRunAbandonmentContext["cleanupTempRef"];
      }
    >`
      SELECT run.id AS validationRunId,
        candidate.change_id AS changeId,
        candidate.id AS candidateId,
        candidate.head_sha AS submittedSha,
        setup.temp_ref_name AS tempRefName,
        setup.worktree_path AS worktreePath,
        setup.cleanup_worktree AS cleanupWorktree,
        setup.cleanup_temp_ref AS cleanupTempRef
      FROM candidate_validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN candidate_validation_workspace_setups AS setup
        ON setup.validation_run_id = run.id
      WHERE run.id = ${validationRunId}
    `,
    (rows) => {
      const row = rows[0];
      if (row === undefined) return undefined;
      const { tempRefName, worktreePath, ...rest } = row;
      return {
        ...rest,
        ...(tempRefName === null ? {} : { tempRefName }),
        ...(worktreePath === null ? {} : { worktreePath }),
      };
    },
  );

const abandon = (
  sql: SqlClient.SqlClient,
  input: {
    readonly validationRunId: string;
    readonly errorKind: string;
    readonly operationName: string;
    readonly errorMessage: string;
    readonly now: string;
  },
) =>
  Effect.zipRight(
    sql`
      INSERT INTO candidate_validation_tooling_failures (
        validation_run_id, error_kind, operation_name, error_message, created_at
      ) VALUES (
        ${input.validationRunId}, ${input.errorKind}, ${input.operationName},
        ${input.errorMessage}, ${input.now}
      )
    `,
    complete(sql, {
      validationRunId: input.validationRunId,
      outcome: "tooling_failed",
      now: input.now,
    }),
  ).pipe(Effect.asVoid);

const getRunById = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.map(
    sql<CandidateValidationRunRow>`
      SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
        implementation_decisions AS implementationDecisions, state, outcome, created_at AS createdAt, updated_at AS updatedAt
      FROM candidate_validation_runs WHERE id = ${validationRunId}
    `,
    (rows) => rows[0],
  );

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  sql<CandidateValidationRunRow>`
    SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
      implementation_decisions AS implementationDecisions, state, outcome, created_at AS createdAt, updated_at AS updatedAt
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
            id, validation_run_id, phase, producer, title, description,
            evidence, files, artifact_refs, created_at, updated_at
          ) VALUES (
            ${finding.id}, ${finding.validationRunId}, ${finding.phase}, ${finding.producer},
            ${finding.title}, ${finding.description}, ${finding.evidence},
            ${encodeSqliteJsonStringArray(finding.files)},
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
  description, evidence, files, artifact_refs AS artifactRefs,
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
       SELECT change_id, created_at, id
       FROM candidates
       WHERE id = ?
     ), latest_valid_reviewer_round AS (
       SELECT prior_round.validation_run_id
       FROM candidates AS prior_candidate
       JOIN current_candidate AS current
         ON current.change_id = prior_candidate.change_id
       JOIN candidate_validation_runs AS prior_run
         ON prior_run.candidate_id = prior_candidate.id
       JOIN candidate_validation_rounds AS prior_round
         ON prior_round.validation_run_id = prior_run.id
       WHERE (
         prior_candidate.created_at < current.created_at
         OR (
           prior_candidate.created_at = current.created_at
           AND prior_candidate.id < current.id
         )
       )
         AND prior_round.phase = ?
         AND prior_round.producer = ?
         AND (
           prior_round.status = 'passed'
           OR EXISTS (
             SELECT 1
             FROM candidate_validation_findings AS finding
             WHERE finding.validation_run_id = prior_round.validation_run_id
               AND finding.phase = prior_round.phase
               AND finding.producer = prior_round.producer
           )
         )
       ORDER BY
         prior_candidate.created_at DESC,
         prior_candidate.id DESC,
         prior_run.created_at DESC,
         prior_run.id DESC,
         prior_round.round_number DESC
       LIMIT 1
     )
     SELECT ${findingColumns}
     FROM candidate_validation_findings
     WHERE validation_run_id = (SELECT validation_run_id FROM latest_valid_reviewer_round)
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
      implementationDecisions: Schema.decodeUnknownSync(
        Schema.parseJson(implementationDecisionSnapshotSchema),
        { onExcessProperty: "error" },
      )(row.implementationDecisions),
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
      const { files, artifactRefs, ...finding } = row;
      return {
        ...finding,
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
  readonly changeBaseSha: string;
  readonly changeId: string;
};
type CandidateValidationRunRow = Omit<
  CandidateValidationRunRecord,
  "policy" | "implementationDecisions"
> & {
  readonly policySnapshot: string;
  readonly implementationDecisions: string;
};
type CandidateValidationFindingRow = Omit<CandidateValidationFinding, "files" | "artifactRefs"> & {
  readonly files: string;
  readonly artifactRefs: string;
};
type CandidateValidationArtifactRow = Omit<CandidateValidationArtifact, "truncated"> & {
  readonly truncated: number;
};
