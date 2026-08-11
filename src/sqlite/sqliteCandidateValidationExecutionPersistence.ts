import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";

import { Effect } from "effect";

import type {
  CandidateValidationFinding,
  RecordCandidateValidationCommandRoundInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import type { CandidateValidationExecutionPort } from "../change/validation/changeValidationPorts.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import { compareCandidatesAscending, readCandidateById } from "./sqliteCandidateStorage.js";
import {
  assertRunOwner,
  decodeValidationFinding,
  decodeValidationRound,
  findingReadColumns,
  listValidationArtifacts,
  listValidationFindings,
  listValidationRounds,
  listValidationToolingFailures,
  type StoredValidationFindingRow,
  type StoredValidationRoundRow,
  validateFindingRoundRelationships,
  validateRoundPolicyRelationships,
} from "./sqliteValidationEvidenceStorage.js";
import {
  decodeValidationRun,
  readActiveValidationRunForChange,
  readValidationRunById,
  type StoredValidationRunRow,
  validateValidationRunAuthorityRelationships,
  validationRunReadColumns,
} from "./sqliteValidationRunStorage.js";
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

export const openSqliteCandidateValidationExecutionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): CandidateValidationExecutionPort => ({
      startOrReuse: (input) =>
        repository.transactionImmediate("start Candidate Validation Run", (sql) =>
          startOrReuse(sql, input),
        ),
      complete: (input) =>
        repository.transactionImmediate("complete Candidate Validation Run", (sql) =>
          complete(sql, input),
        ),
      recordWorkspaceCleanup: (input) =>
        repository
          .operation(
            "record Candidate Snapshot Workspace cleanup",
            (sql) => sql<{ readonly validationRunId: string }>`
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
    }),
  );

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
    const active = yield* getActiveForChange(
      sql,
      candidate.changeId,
      "read Active Candidate Validation Run",
    );
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
  Effect.gen(function* () {
    const completed = yield* sql<{ readonly validationRunId: string }>`
      UPDATE candidate_validation_runs
      SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
      WHERE id = ${input.validationRunId}
        AND NOT EXISTS (
          SELECT 1 FROM candidate_snapshot_workspaces
          WHERE validation_run_id = ${input.validationRunId} AND cleanup_workspace = 'failed'
        )
      RETURNING id AS validationRunId
    `;
    if (completed.length === 1 && completed[0]?.validationRunId === input.validationRunId) {
      yield* sql`
        DELETE FROM active_validation_runs WHERE validation_run_id = ${input.validationRunId}
      `;
    }
  }).pipe(Effect.asVoid);

const getActiveForChange = readActiveValidationRunForChange;

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

const listRounds = listValidationRounds;
const listFindings = listValidationFindings;

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

const listToolingFailures = listValidationToolingFailures;
const listArtifacts = listValidationArtifacts;

const requireRun = (sql: SqlClient.SqlClient, validationRunId: string, operationName: string) =>
  Effect.flatMap(
    readValidationRunById(sql, validationRunId, "decode Candidate Validation Run"),
    (run) =>
      run === undefined
        ? invalidData(operationName, "Validation evidence belongs to an unknown Run")
        : Effect.succeed(run),
  );

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
