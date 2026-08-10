import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  RecordCandidateValidationCommandRoundInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../change/validation/changeValidationPorts.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  candidateReadColumns,
  decodeAbandonmentContext,
  decodeActiveValidationRun,
  decodeCandidate,
  decodeToolingFailure,
  decodeValidationArtifact,
  decodeValidationFinding,
  decodeValidationRound,
  decodeValidationRun,
  findingReadColumns,
  type UnknownAbandonmentContextRow,
  type UnknownActiveValidationRunRow,
  type UnknownCandidateRow,
  type UnknownToolingFailureRow,
  type UnknownValidationArtifactRow,
  type UnknownValidationFindingRow,
  type UnknownValidationRoundRow,
  type UnknownValidationRunRow,
  validateValidationRunAuthorityRelationships,
  validationRunReadColumns,
} from "./sqliteCandidateValidationReadModel.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type UnknownImplementationBlockerRow,
  type UnknownImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { decodePersisted, decodeStoredString } from "./sqliteTaskReadModel.js";

const makeSqliteChangeValidationAdapter = (
  repository: import("effect").Context.Tag.Service<typeof RepositorySql>,
): CandidateValidationExecutionPort &
  ChangeValidationReadPort &
  ActiveValidationRunPort &
  ValidationRunAbandonmentPort &
  ValidationArtifactLifecyclePort => ({
  getCandidateById: (candidateId) =>
    repository.transaction("read Candidate for validation history", (sql) =>
      readCandidateById(sql, candidateId, "read Candidate for validation history"),
    ),
  listCandidatesForChange: (changeId) =>
    repository.transaction("list Candidates for validation history", (sql) =>
      readCandidatesForChange(sql, changeId, "list Candidates for validation history"),
    ),
  listRunIdsForChange: (changeId) =>
    repository.transaction("list Candidate Validation Run IDs", (sql) =>
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
    repository.transaction("read Active Candidate Validation Run", (sql) =>
      getActiveForChange(sql, changeId),
    ),
  getAbandonmentContext: (validationRunId) =>
    repository.transaction("read Candidate Validation Run abandonment context", (sql) =>
      getAbandonmentContext(sql, validationRunId),
    ),
  abandon: (input) =>
    repository.transactionImmediate("abandon Candidate Validation Run", (sql) =>
      abandon(sql, input),
    ),
  getRunById: (validationRunId) =>
    repository.transaction("read Candidate Validation Run", (sql) =>
      getRunById(sql, validationRunId),
    ),
  listRunsForCandidate: (candidateId) =>
    repository.transaction("list Candidate Validation Runs", (sql) =>
      listRunsForCandidate(sql, candidateId),
    ),
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
      recordRound(sql, { ...input, phase: validationPhase.prepare, producer: "prepare" }),
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
    repository.transaction("list Candidate validation rounds", (sql) =>
      listRounds(sql, validationRunId),
    ),
  listFindings: (validationRunId) =>
    repository.transaction("list Candidate validation Findings", (sql) =>
      listFindings(sql, validationRunId),
    ),
  listPreviousCandidateReviewerFindings: (input) =>
    repository.transaction("list previous Candidate reviewer Findings", (sql) =>
      listPreviousCandidateReviewerFindings(sql, input),
    ),
  listToolingFailures: (validationRunId) =>
    repository.transaction("list Candidate validation Tooling Failures", (sql) =>
      listToolingFailures(sql, validationRunId),
    ),
  listArtifacts: (validationRunId) =>
    repository.transaction("list Candidate validation Artifacts", (sql) =>
      listArtifacts(sql, validationRunId),
    ),
});

export const openSqliteCandidateValidationExecutionPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeValidationAdapter(repository);
    return {
      startOrReuse: adapter.startOrReuse,
      complete: adapter.complete,
      recordWorkspaceSetup: adapter.recordWorkspaceSetup,
      recordToolingFailure: adapter.recordToolingFailure,
      recordPrepareRound: adapter.recordPrepareRound,
      recordCheckRound: adapter.recordCheckRound,
      recordAcceptanceRound: adapter.recordAcceptanceRound,
      recordSpecialistRound: adapter.recordSpecialistRound,
      listRounds: adapter.listRounds,
      listFindings: adapter.listFindings,
      listPreviousCandidateReviewerFindings: adapter.listPreviousCandidateReviewerFindings,
      listToolingFailures: adapter.listToolingFailures,
      listArtifacts: adapter.listArtifacts,
    };
  });

export const openSqliteChangeValidationReadPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeValidationAdapter(repository);
    return {
      getCandidateById: adapter.getCandidateById,
      listCandidatesForChange: adapter.listCandidatesForChange,
      getRunById: adapter.getRunById,
      listRunsForCandidate: adapter.listRunsForCandidate,
      listRounds: adapter.listRounds,
      listFindings: adapter.listFindings,
      listToolingFailures: adapter.listToolingFailures,
      listArtifacts: adapter.listArtifacts,
    };
  });

export const openSqliteActiveValidationRunPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeValidationAdapter(repository);
    return {
      getActiveForChange: adapter.getActiveForChange,
    };
  });

export const openSqliteValidationRunAbandonmentPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeValidationAdapter(repository);
    return {
      getAbandonmentContext: adapter.getAbandonmentContext,
      getRunById: adapter.getRunById,
      recordToolingFailure: adapter.recordToolingFailure,
      abandon: adapter.abandon,
    };
  });

export const openSqliteValidationArtifactLifecyclePort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeValidationAdapter(repository);
    return {
      listRunIdsForChange: adapter.listRunIdsForChange,
    };
  });

type CandidateOwnerRow = UnknownCandidateRow & { readonly storedChangeId: unknown };

const decodeOwnedCandidate = (
  row: CandidateOwnerRow,
  expectedChangeId?: string,
): CandidateRecord => {
  const candidate = decodeCandidate(row);
  const storedChangeId = decodeStoredString(row.storedChangeId, "Candidate owner Change ID");
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
const listRunIdsForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly runId: unknown;
      readonly runCandidateId: unknown;
      readonly candidateId: unknown;
      readonly candidateChangeId: unknown;
      readonly createdAt: unknown;
    }>`
      SELECT run.id AS runId, run.candidate_id AS runCandidateId,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId,
        run.created_at AS createdAt
      FROM candidates AS candidate
      JOIN candidate_validation_runs AS run ON run.candidate_id = candidate.id
      WHERE candidate.change_id = ${changeId}
    `;
    return yield* decodePersisted("list Candidate Validation Run IDs", () =>
      rows
        .map((row) => {
          const runId = decodeStoredString(row.runId, "Validation Run ID");
          const runCandidateId = decodeStoredString(
            row.runCandidateId,
            "Validation Run Candidate ID",
          );
          const candidateId = decodeStoredString(row.candidateId, "Candidate ID");
          const candidateChangeId = decodeStoredString(
            row.candidateChangeId,
            "Candidate Change ID",
          );
          if (runCandidateId !== candidateId || candidateChangeId !== changeId) {
            throw new Error("Validation Run cleanup relationship is inconsistent");
          }
          return {
            id: runId,
            createdAt: decodeStoredString(row.createdAt, "Validation Run creation time"),
          };
        })
        .sort(
          (left, right) =>
            compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id),
        )
        .map(({ id }) => id),
    );
  });

const startOrReuse = (sql: SqlClient.SqlClient, input: StartCandidateValidationRunInput) =>
  Effect.gen(function* () {
    const candidate = yield* readCandidateById(
      sql,
      input.candidateId,
      "start Candidate Validation Run",
    );
    if (
      candidate === undefined ||
      candidate.headSha !== input.headSha ||
      (input.changeBaseSha !== undefined && candidate.changeBaseSha !== input.changeBaseSha)
    ) {
      return yield* invalidData(
        "start Candidate Validation Run",
        "Candidate validation requires the exact stored Candidate identity.",
      );
    }
    const currentCandidateRows = yield* sql<{ readonly id: unknown }>`
      SELECT id FROM candidates
      WHERE change_id = ${candidate.changeId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    const currentCandidateId = yield* decodePersisted("start Candidate Validation Run", () => {
      const row = currentCandidateRows[0];
      if (row === undefined) throw new Error("Candidate validation requires a current Candidate");
      return decodeStoredString(row.id, "current Candidate ID");
    });
    if (currentCandidateId !== candidate.id) {
      return yield* invalidData(
        "start Candidate Validation Run",
        "Candidate validation requires the current Candidate for its Change.",
      );
    }

    const changeRows = yield* sql<{
      readonly id: unknown;
      readonly state: unknown;
      readonly taskId: unknown;
      readonly acceptanceContext: unknown;
    }>`SELECT id, state, task_id AS taskId, acceptance_context AS acceptanceContext
       FROM changes WHERE id = ${candidate.changeId}`;
    const changeAuthority = yield* decodePersisted("start Candidate Validation Run", () => {
      const row = changeRows[0];
      if (row === undefined || decodeStoredString(row.id, "Change ID") !== candidate.changeId) {
        throw new Error("Candidate validation requires the current owning Change");
      }
      if (decodeStoredString(row.state, "Change state") !== "open") {
        throw new Error("Candidate validation requires an open Change");
      }
      const taskId = row.taskId;
      if (taskId !== null && typeof taskId !== "string") {
        throw new Error("Change Task ID must be stored as text or null");
      }
      const encodedAcceptanceContext = row.acceptanceContext;
      if (encodedAcceptanceContext !== null && typeof encodedAcceptanceContext !== "string") {
        throw new Error("Change Acceptance Context must be stored as text or null");
      }
      if ((taskId === null) !== (encodedAcceptanceContext === null)) {
        throw new Error("Change Task and Acceptance Context authority is incomplete");
      }
      return {
        acceptanceContext:
          encodedAcceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
      };
    });
    const decisionRows = yield* sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${candidate.changeId}
    `;
    const implementationDecisions = yield* decodePersisted("start Candidate Validation Run", () =>
      decodeImplementationDecisions(decisionRows, candidate.changeId),
    );

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
      return { reused: false, blocked: true } satisfies StartCandidateValidationRunResult;
    }
    const currentLatestResolvedBlockerId = latestResolvedBlockerId(blockerHistory);
    const policy = {
      ...input.policy,
      ...(changeAuthority.acceptanceContext === null
        ? {}
        : { acceptanceContext: changeAuthority.acceptanceContext }),
    };
    const authority = {
      candidate,
      policy,
      implementationDecisions,
      blockerHistory,
      latestResolvedBlockerId: currentLatestResolvedBlockerId,
    };
    const policySnapshot = yield* Effect.try({
      try: () => encodeSqliteCandidateValidationPolicy(policy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "start Candidate Validation Run",
          cause,
        }),
    });
    const decisionsSnapshot = JSON.stringify(implementationDecisions);

    const historyRows = yield* sql.unsafe<UnknownValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ?`,
      [candidate.id],
    );
    const history = yield* decodePersisted("start Candidate Validation Run", () =>
      historyRows.map((row) => {
        const decoded = decodeValidationRun(row);
        if (decoded.record.candidateId !== candidate.id) {
          throw new Error("Validation Run belongs to another Candidate");
        }
        validateValidationRunAuthorityRelationships(decoded, candidate.changeId, blockerHistory);
        return decoded;
      }),
    );
    const reusable = history.find(
      (run) =>
        run.record.state === "complete" &&
        run.record.outcome === "passed" &&
        run.policySnapshot === policySnapshot &&
        run.implementationDecisionsSnapshot === decisionsSnapshot &&
        run.latestResolvedBlockerId === currentLatestResolvedBlockerId,
    );
    if (reusable !== undefined) {
      return {
        reused: true,
        validationRunId: reusable.record.id,
        outcome: "passed",
        authority,
      } satisfies StartCandidateValidationRunResult;
    }

    const validationRunId = input.validationRunId ?? randomUUID();
    const active = yield* getActiveForChange(sql, candidate.changeId);
    if (active !== undefined) {
      return {
        reused: false,
        active: true,
        validationRunId: active.validationRunId,
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
          ${validationRunId}, ${input.workspaceSetup.tempRefName}, ${candidate.headSha}, ${candidate.headSha},
          ${input.workspaceSetup.worktreePath}, 'not_created', 'not_created', ${input.now}
        )
      `;
    }
    return {
      reused: false,
      validationRunId,
      authority,
    } satisfies StartCandidateValidationRunResult;
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
  Effect.gen(function* () {
    const rows = yield* sql<UnknownActiveValidationRunRow>`
      SELECT active.validation_run_id AS validationRunId, active.change_id AS changeId,
        run.id AS runId, run.candidate_id AS runCandidateId,
        run.state AS runState, run.outcome AS runOutcome,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId,
        change_row.id AS storedChangeId
      FROM active_validation_runs AS active
      LEFT JOIN candidate_validation_runs AS run ON run.id = active.validation_run_id
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      WHERE active.change_id = ${changeId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted("read Active Candidate Validation Run", () =>
          decodeActiveValidationRun(row, changeId),
        );
  });

const getAbandonmentContext = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<UnknownAbandonmentContextRow>`
      SELECT run.id AS validationRunId, run.candidate_id AS runCandidateId,
        candidate.change_id AS changeId, change_row.id AS storedChangeId,
        candidate.id AS candidateId, candidate.head_sha AS submittedSha,
        setup.validation_run_id AS setupValidationRunId,
        setup.submitted_sha AS setupSubmittedSha, setup.worktree_head AS setupWorktreeHead,
        setup.temp_ref_name AS tempRefName, setup.worktree_path AS worktreePath,
        setup.cleanup_worktree AS cleanupWorktree, setup.cleanup_temp_ref AS cleanupTempRef
      FROM candidate_validation_runs AS run
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      LEFT JOIN candidate_validation_workspace_setups AS setup ON setup.validation_run_id = run.id
      WHERE run.id = ${validationRunId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted("read Candidate Validation Run abandonment context", () =>
          decodeAbandonmentContext(row, validationRunId),
        );
  });

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
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<UnknownValidationRunRow>(
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
    const blockers = yield* readBlockerHistory(
      sql,
      candidate.changeId,
      "decode Candidate Validation Run",
    );
    yield* decodePersisted("decode Candidate Validation Run", () =>
      validateValidationRunAuthorityRelationships(decoded, candidate.changeId, blockers),
    );
    return decoded.record;
  });

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<UnknownValidationRunRow>(
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
    const blockers = yield* readBlockerHistory(
      sql,
      candidate.changeId,
      "decode Candidate Validation Run",
    );
    return yield* decodePersisted("decode Candidate Validation Run", () =>
      rows
        .map((row) => {
          const decoded = decodeValidationRun(row);
          if (decoded.record.candidateId !== candidateId)
            throw new Error("Validation Run belongs to another Candidate");
          validateValidationRunAuthorityRelationships(decoded, candidate.changeId, blockers);
          return decoded.record;
        })
        .sort(
          (left, right) =>
            compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id),
        ),
    );
  });

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
  Effect.gen(function* () {
    const rows = yield* sql<UnknownValidationRoundRow>`
      SELECT validation_run_id AS validationRunId, phase, producer,
        CAST(round_number AS TEXT) AS roundNumber, typeof(round_number) AS roundNumberType,
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
    const rows = yield* sql.unsafe<UnknownValidationFindingRow>(
      `SELECT ${findingReadColumns}
       FROM candidate_validation_findings
       WHERE validation_run_id = ?`,
      [validationRunId],
    );
    const rounds = yield* listRounds(sql, validationRunId);
    return yield* decodePersisted("decode Candidate validation Finding", () => {
      const findings = rows.map((row) =>
        assertRunOwner(decodeValidationFinding(row), validationRunId),
      );
      validateFindingRoundRelationships(findings, rounds);
      return findings.sort((left, right) => compareEvidence(left, right, rounds));
    });
  });

const listPreviousCandidateReviewerFindings = (
  sql: SqlClient.SqlClient,
  input: {
    readonly candidateId: string;
    readonly phase: CandidateValidationFinding["phase"];
    readonly producer: string;
  },
) =>
  Effect.gen(function* () {
    const current = yield* readCandidateById(
      sql,
      input.candidateId,
      "list previous Candidate reviewer Findings",
    );
    if (current === undefined) return [];
    const candidates = yield* readCandidatesForChange(
      sql,
      current.changeId,
      "list previous Candidate reviewer Findings",
    );
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const blockers = yield* readBlockerHistory(
      sql,
      current.changeId,
      "list previous Candidate reviewer Findings",
    );
    const runRows = yield* sql.unsafe<
      UnknownValidationRunRow & { readonly runCandidateId: unknown }
    >(
      `SELECT ${validationRunReadColumns}, candidate_id AS runCandidateId
       FROM candidate_validation_runs
       WHERE candidate_id IN (SELECT id FROM candidates WHERE change_id = ?)`,
      [current.changeId],
    );
    const runs = yield* decodePersisted("list previous Candidate reviewer Findings", () =>
      runRows.map((row) => {
        const decoded = decodeValidationRun(row);
        const run = decoded.record;
        const owner = decodeStoredString(row.runCandidateId, "Validation Run Candidate ID");
        if (run.candidateId !== owner || !candidateIds.has(owner)) {
          throw new Error("Validation Run belongs to a foreign Candidate");
        }
        validateValidationRunAuthorityRelationships(decoded, current.changeId, blockers);
        return run;
      }),
    );
    const runIds = new Set(runs.map((run) => run.id));
    const roundRows = yield* sql<UnknownValidationRoundRow>`
      SELECT validation_run_id AS validationRunId, phase, producer,
        CAST(round_number AS TEXT) AS roundNumber, typeof(round_number) AS roundNumberType,
        status, created_at AS createdAt
      FROM candidate_validation_rounds
      WHERE validation_run_id IN (
        SELECT run.id FROM candidate_validation_runs AS run
        JOIN candidates AS candidate ON candidate.id = run.candidate_id
        WHERE candidate.change_id = ${current.changeId}
      )
    `;
    const findingRows = yield* sql.unsafe<UnknownValidationFindingRow>(
      `SELECT ${findingReadColumns}
       FROM candidate_validation_findings
       WHERE validation_run_id IN (
         SELECT run.id FROM candidate_validation_runs AS run
         JOIN candidates AS candidate ON candidate.id = run.candidate_id
         WHERE candidate.change_id = ?
       )`,
      [current.changeId],
    );
    const decoded = yield* decodePersisted("list previous Candidate reviewer Findings", () => {
      const rounds = roundRows.map((row) => {
        const round = decodeValidationRound(row);
        if (!runIds.has(round.validationRunId))
          throw new Error("Validation round belongs to a foreign Run");
        return round;
      });
      validateRoundPolicyRelationships(rounds, new Map(runs.map((run) => [run.id, run])));
      const findings = findingRows.map((row) => {
        const finding = decodeValidationFinding(row);
        if (!runIds.has(finding.validationRunId))
          throw new Error("Finding belongs to a foreign Run");
        return finding;
      });
      validateFindingRoundRelationships(findings, rounds);
      return { rounds, findings };
    });

    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const runsById = new Map(runs.map((run) => [run.id, run]));
    const eligibleRounds = decoded.rounds.filter((round) => {
      const run = runsById.get(round.validationRunId);
      const candidate = run === undefined ? undefined : candidatesById.get(run.candidateId);
      if (candidate === undefined || compareCandidatesAscending(candidate, current) >= 0)
        return false;
      if (round.phase !== input.phase || round.producer !== input.producer) return false;
      return (
        round.status === "passed" ||
        decoded.findings.some(
          (finding) =>
            finding.validationRunId === round.validationRunId &&
            finding.phase === round.phase &&
            finding.producer === round.producer,
        )
      );
    });
    eligibleRounds.sort((left, right) => comparePriorRounds(right, left, runsById, candidatesById));
    const selected = eligibleRounds[0];
    if (selected === undefined) return [];
    return decoded.findings
      .filter(
        (finding) =>
          finding.validationRunId === selected.validationRunId &&
          finding.phase === input.phase &&
          finding.producer === input.producer,
      )
      .sort((left, right) => compareStrings(left.id, right.id));
  });

const listToolingFailures = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<UnknownToolingFailureRow>`
      SELECT CAST(sequence AS TEXT) AS sequence, typeof(sequence) AS sequenceType,
        validation_run_id AS validationRunId, error_kind AS errorKind,
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
    const run = yield* getRunById(sql, validationRunId);
    if (run === undefined) {
      return yield* invalidData(
        "list Candidate validation Tooling Failures",
        "Tooling Failures belong to an unknown Run",
      );
    }
    return failures;
  });

const listArtifacts = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<UnknownValidationArtifactRow>`
      SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
        CAST(original_bytes AS TEXT) AS originalBytes, typeof(original_bytes) AS originalBytesType,
        CAST(stored_bytes AS TEXT) AS storedBytes, typeof(stored_bytes) AS storedBytesType,
        CAST(truncated AS TEXT) AS truncated, typeof(truncated) AS truncatedType,
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
    const rounds = yield* listRounds(sql, validationRunId);
    yield* decodePersisted("list Candidate validation Artifacts", () =>
      validateArtifactRoundRelationships(artifacts, rounds),
    );
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
  const roundKeys = new Set<string>();
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
    const key = `${round.validationRunId}\u0000${round.phase}\u0000${round.producer}`;
    if (roundKeys.has(key)) throw new Error("Validation round relationship is duplicated");
    roundKeys.add(key);
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

const validateArtifactRoundRelationships = (
  artifacts: readonly CandidateValidationArtifact[],
  rounds: readonly CandidateValidationRound[],
): void => {
  for (const artifact of artifacts) {
    const relatedRounds = rounds.filter(
      (round) =>
        round.validationRunId === artifact.validationRunId &&
        round.phase === artifact.phase &&
        round.producer === artifact.producer,
    );
    if (relatedRounds.length !== 1) {
      throw new Error("Artifact does not belong to exactly one Validation round");
    }
  }
};

const compareCandidatesAscending = (left: CandidateRecord, right: CandidateRecord): number =>
  compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);

const comparePriorRounds = (
  left: CandidateValidationRound,
  right: CandidateValidationRound,
  runs: ReadonlyMap<
    string,
    { readonly id: string; readonly candidateId: string; readonly createdAt: string }
  >,
  candidates: ReadonlyMap<string, CandidateRecord>,
): number => {
  const leftRun = runs.get(left.validationRunId);
  const rightRun = runs.get(right.validationRunId);
  if (leftRun === undefined || rightRun === undefined)
    throw new Error("Validation round has no Run");
  const leftCandidate = candidates.get(leftRun.candidateId);
  const rightCandidate = candidates.get(rightRun.candidateId);
  if (leftCandidate === undefined || rightCandidate === undefined)
    throw new Error("Validation Run has no Candidate");
  return (
    compareCandidatesAscending(leftCandidate, rightCandidate) ||
    compareStrings(leftRun.createdAt, rightRun.createdAt) ||
    compareStrings(leftRun.id, rightRun.id) ||
    left.roundNumber - right.roundNumber
  );
};

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const readBlockerHistory = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ?`,
      [changeId],
    );
    return yield* decodePersisted(operationName, () =>
      decodeImplementationBlockerHistory(rows, changeId),
    );
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
