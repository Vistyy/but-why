import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { type Context, Effect } from "effect";

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
  type StoredAbandonmentContextRow,
  type StoredActiveValidationRunRow,
  type StoredCandidateRow,
  type StoredToolingFailureRow,
  type StoredValidationArtifactRow,
  type StoredValidationFindingRow,
  type StoredValidationRoundRow,
  type StoredValidationRunRow,
  validateValidationRunAuthorityRelationships,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
  validationRunReadColumns,
} from "./sqliteCandidateValidationReadModel.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeReadModel.js";
import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

const makeSqliteChangeValidationAdapter = (
  repository: Context.Tag.Service<typeof RepositorySql>,
): CandidateValidationExecutionPort &
  ChangeValidationReadPort &
  ActiveValidationRunPort &
  ValidationRunAbandonmentPort &
  ValidationArtifactLifecyclePort => ({
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
  getLatestRunForCandidate: (candidateId) =>
    repository.transaction("read latest Candidate Validation Run", (sql) =>
      getLatestRunForCandidate(sql, candidateId),
    ),
  listRunsForCandidate: (candidateId) =>
    repository.transaction("list Candidate Validation Runs", (sql) =>
      listRunsForCandidate(sql, candidateId),
    ),
  recordWorkspaceCleanup: (input) =>
    repository
      .operation(
        "record Candidate Snapshot Workspace cleanup",
        (sql) =>
          sql<{ readonly validationRunId: string }>`
          UPDATE candidate_snapshot_workspaces
          SET cleanup_workspace = ${input.cleanupWorkspace}
          WHERE validation_run_id = ${input.validationRunId}
          RETURNING validation_run_id AS validationRunId
        `,
      )
      .pipe(
        Effect.flatMap((updated) =>
          updated.length === 1 && updated[0]?.validationRunId === input.validationRunId
            ? Effect.void
            : invalidData(
                "record Candidate Snapshot Workspace cleanup",
                "Snapshot Workspace cleanup requires its persisted Validation Run identity.",
              ),
        ),
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
      recordWorkspaceCleanup: adapter.recordWorkspaceCleanup,
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
      getCurrentCandidateForChange: adapter.getCurrentCandidateForChange,
      listCandidatesForChange: adapter.listCandidatesForChange,
      getRunById: adapter.getRunById,
      getLatestRunForCandidate: adapter.getLatestRunForCandidate,
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
const listRunIdsForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly runId: string;
      readonly runCandidateId: string;
      readonly candidateId: string;
      readonly candidateChangeId: string;
      readonly createdAt: string;
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
          const runId = row.runId;
          const runCandidateId = row.runCandidateId;
          const candidateId = row.candidateId;
          const candidateChangeId = row.candidateChangeId;
          if (runCandidateId !== candidateId || candidateChangeId !== changeId) {
            throw new Error("Validation Run cleanup relationship is inconsistent");
          }
          return {
            id: runId,
            createdAt: row.createdAt,
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
    const currentCandidateRows = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidates
      WHERE change_id = ${candidate.changeId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    const currentCandidateId = yield* decodePersisted("start Candidate Validation Run", () => {
      const row = currentCandidateRows[0];
      if (row === undefined) throw new Error("Candidate validation requires a current Candidate");
      return row.id;
    });
    if (currentCandidateId !== candidate.id) {
      return yield* invalidData(
        "start Candidate Validation Run",
        "Candidate validation requires the current Candidate for its Change.",
      );
    }

    const changeRows = yield* sql<{
      readonly id: string;
      readonly state: "open" | "closed";
      readonly taskId: string | null;
      readonly acceptanceContext: string | null;
    }>`SELECT id, state, task_id AS taskId, acceptance_context AS acceptanceContext
       FROM changes WHERE id = ${candidate.changeId}`;
    const changeAuthority = yield* decodePersisted("start Candidate Validation Run", () => {
      const row = changeRows[0];
      if (row === undefined || row.id !== candidate.changeId) {
        throw new Error("Candidate validation requires the current owning Change");
      }
      if (row.state !== "open") {
        throw new Error("Candidate validation requires an open Change");
      }
      const encodedAcceptanceContext = row.acceptanceContext;
      return {
        acceptanceContext:
          encodedAcceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
      };
    });
    const decisionRows = yield* sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${candidate.changeId}
    `;
    const implementationDecisions = yield* decodePersisted("start Candidate Validation Run", () =>
      decodeImplementationDecisions(decisionRows, candidate.changeId),
    );

    const blockerRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
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

    const reusableRows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ? AND state = 'complete' AND outcome = 'passed'
         AND policy_snapshot = ? AND implementation_decisions = ?
         AND latest_resolved_blocker_id IS ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [candidate.id, policySnapshot, decisionsSnapshot, currentLatestResolvedBlockerId],
    );
    const reusableRow = reusableRows[0];
    const reusable =
      reusableRow === undefined
        ? undefined
        : yield* decodePersisted("start Candidate Validation Run", () => {
            const decoded = decodeValidationRun(reusableRow);
            if (decoded.record.candidateId !== candidate.id) {
              throw new Error("Validation Run belongs to another Candidate");
            }
            validateValidationRunAuthorityRelationships(
              decoded,
              candidate.changeId,
              blockerHistory,
            );
            return decoded;
          });
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
        INSERT INTO candidate_snapshot_workspaces (
          validation_run_id, expected_commit_sha, workspace_path, cleanup_workspace, created_at
        ) VALUES (
          ${validationRunId}, ${candidate.headSha}, ${input.workspaceSetup.worktreePath},
          'not_created', ${input.now}
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
    const rows = yield* sql<StoredAbandonmentContextRow>`
      SELECT run.id AS validationRunId, run.candidate_id AS runCandidateId,
        candidate.change_id AS changeId, change_row.id AS storedChangeId,
        candidate.id AS candidateId, candidate.head_sha AS submittedSha,
        setup.validation_run_id AS setupValidationRunId,
        setup.expected_commit_sha AS setupExpectedCommitSha,
        setup.workspace_path AS worktreePath, setup.cleanup_workspace AS cleanupWorkspace,
        pre_native.retired_ref_name AS preNativeRefName,
        pre_native.workspace_path AS preNativeWorkspacePath,
        pre_native.expected_commit_sha AS preNativeExpectedCommitSha
      FROM candidate_validation_runs AS run
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      LEFT JOIN candidate_snapshot_workspaces AS setup ON setup.validation_run_id = run.id
      LEFT JOIN pre_native_snapshot_workspace_cleanups AS pre_native
        ON pre_native.validation_run_id = run.id
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
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO candidate_validation_tooling_failures (
        validation_run_id, error_kind, operation_name, error_message, created_at
      ) VALUES (
        ${input.validationRunId}, ${input.errorKind}, ${input.operationName},
        ${input.errorMessage}, ${input.now}
      )
    `;
    yield* complete(sql, {
      validationRunId: input.validationRunId,
      outcome: "tooling_failed",
      now: input.now,
    });
    yield* sql`
      DELETE FROM pre_native_snapshot_workspace_cleanups
      WHERE validation_run_id = ${input.validationRunId}
    `;
  }).pipe(Effect.asVoid);

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
    const selectedRows = yield* sql<{
      readonly candidateId: string;
      readonly validationRunId: string;
    }>`
      SELECT candidate.id AS candidateId, run.id AS validationRunId
      FROM candidates AS candidate
      JOIN candidate_validation_runs AS run ON run.candidate_id = candidate.id
      JOIN candidate_validation_rounds AS round ON round.validation_run_id = run.id
      WHERE candidate.change_id = ${current.changeId}
        AND (candidate.created_at < ${current.createdAt}
          OR (candidate.created_at = ${current.createdAt} AND candidate.id < ${current.id}))
        AND round.phase = ${input.phase} AND round.producer = ${input.producer}
        AND (round.status = 'passed' OR EXISTS (
          SELECT 1 FROM candidate_validation_findings AS finding
          WHERE finding.validation_run_id = round.validation_run_id
            AND finding.phase = round.phase AND finding.producer = round.producer
        ))
      ORDER BY candidate.created_at DESC, candidate.id DESC,
        run.created_at DESC, run.id DESC, round.round_number DESC
      LIMIT 1
    `;
    const selected = selectedRows[0];
    if (selected === undefined) return [];
    const candidate = yield* readCandidateById(
      sql,
      selected.candidateId,
      "list previous Candidate reviewer Findings",
    );
    if (
      candidate === undefined ||
      candidate.changeId !== current.changeId ||
      compareCandidatesAscending(candidate, current) >= 0
    ) {
      return yield* invalidData(
        "list previous Candidate reviewer Findings",
        "Selected reviewer history belongs to an unrelated Candidate",
      );
    }
    const run = yield* requireRun(
      sql,
      selected.validationRunId,
      "list previous Candidate reviewer Findings",
    );
    if (run.candidateId !== candidate.id) {
      return yield* invalidData(
        "list previous Candidate reviewer Findings",
        "Selected reviewer history belongs to an unrelated Validation Run",
      );
    }
    const roundRows = yield* sql<StoredValidationRoundRow>`
      SELECT validation_run_id AS validationRunId, phase, producer,
        round_number AS roundNumber,
        status, created_at AS createdAt
      FROM candidate_validation_rounds
      WHERE validation_run_id = ${run.id}
        AND phase = ${input.phase} AND producer = ${input.producer}
    `;
    const findingRows = yield* sql.unsafe<StoredValidationFindingRow>(
      `SELECT ${findingReadColumns}
       FROM candidate_validation_findings
       WHERE validation_run_id = ? AND phase = ? AND producer = ?`,
      [run.id, input.phase, input.producer],
    );
    return yield* decodePersisted("list previous Candidate reviewer Findings", () => {
      const rounds = roundRows.map((row) => assertRunOwner(decodeValidationRound(row), run.id));
      validateRoundPolicyRelationships(rounds, new Map([[run.id, run]]));
      const findings = findingRows.map((row) =>
        assertRunOwner(decodeValidationFinding(row), run.id),
      );
      validateFindingRoundRelationships(findings, rounds);
      return findings.sort((left, right) => compareStrings(left.id, right.id));
    });
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
