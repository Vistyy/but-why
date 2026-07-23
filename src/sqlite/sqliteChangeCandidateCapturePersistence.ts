import type * as SqlClient from "@effect/sql/SqlClient";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";

import { changeState } from "../change/change.js";
import type {
  CandidateCaptureChange,
  ChangeCandidateCapturePersistence,
  CommitCandidateCaptureInput,
  CommitCandidateCaptureResult,
} from "../change/candidateCapture/changeCandidateCapturePersistence.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";

type StoredCandidate = {
  readonly id: string;
  readonly selectedBaseRef: string;
  readonly resolvedTargetSha: string;
};

type CommitRejection = Extract<CommitCandidateCaptureResult, { readonly ok: false }>;

export const openSqliteChangeCandidateCapturePersistence = (): Effect.Effect<
  ChangeCandidateCapturePersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    getChangeById: (changeId) =>
      repository.operation("read Change for Candidate capture", (sql) =>
        getChangeById(sql, changeId),
      ),
    getChangeByRepositoryBranch: (repositoryCommonDirectory, branchRef) =>
      repository.operation("read Change branch for Candidate capture", (sql) =>
        getChangeByBranch(sql, repositoryCommonDirectory, branchRef),
      ),
    commitCapture: (input) =>
      repository.transactionImmediate("commit Candidate capture", (sql) =>
        commitCapture(sql, input),
      ),
  }));

const commitCapture = (sql: SqlClient.SqlClient, input: CommitCandidateCaptureInput) =>
  Effect.gen(function* () {
    const selected = yield* selectStoredChange(sql, input);
    if (!selected.ok) return selected;
    const baseAssignment = yield* assignBase(sql, selected.change, input);
    if (!baseAssignment.ok) return baseAssignment;
    const candidate = yield* captureStoredCandidate(sql, selected.change.id, input);
    if (!candidate.ok) return candidate;

    return {
      ok: true,
      changeId: selected.change.id,
      candidateId: candidate.candidateId,
      reused: candidate.reused,
    } as const;
  });

const selectStoredChange = (sql: SqlClient.SqlClient, input: CommitCandidateCaptureInput) =>
  Effect.gen(function* () {
    const destination = yield* getChangeByBranch(
      sql,
      input.repositoryCommonDirectory,
      input.branchRef,
    );
    return input.expectedChangeId === undefined
      ? yield* createStoredChange(sql, input, destination)
      : yield* selectExpectedChange(sql, input.expectedChangeId, input, destination);
  });

const createStoredChange = (
  sql: SqlClient.SqlClient,
  input: CommitCandidateCaptureInput,
  destination: CandidateCaptureChange | undefined,
) =>
  Effect.gen(function* () {
    if (destination !== undefined) {
      return { ok: false, code: "destination_branch_has_history" } as const;
    }
    const changeId = randomUUID();
    yield* sql`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, base_ref, task_id, state,
        close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${changeId}, ${input.repositoryCommonDirectory}, ${input.branchRef}, NULL, NULL,
        'open', NULL, ${input.now}, ${input.now}, NULL
      )
    `;
    const change = yield* getChangeById(sql, changeId);
    if (change === undefined)
      return yield* invalidData("Change disappeared after capture creation");
    return { ok: true, change } as const;
  });

const selectExpectedChange = (
  sql: SqlClient.SqlClient,
  expectedChangeId: string,
  input: CommitCandidateCaptureInput,
  destination: CandidateCaptureChange | undefined,
) =>
  Effect.gen(function* () {
    const expected = yield* getChangeById(sql, expectedChangeId);
    if (expected === undefined) return { ok: false, code: "change_not_found" } as const;
    if (expected.state === changeState.closed) return { ok: false, code: "change_closed" } as const;
    if (expected.repositoryCommonDirectory !== input.repositoryCommonDirectory) {
      return { ok: false, code: "change_binding_conflict" } as const;
    }
    if (expected.branchRef === input.branchRef) {
      return destination?.id === expected.id
        ? ({ ok: true, change: expected } as const)
        : ({ ok: false, code: "change_binding_conflict" } as const);
    }
    if (input.rebindFromRef !== expected.branchRef) {
      return { ok: false, code: "change_binding_conflict" } as const;
    }
    if (destination !== undefined) {
      return { ok: false, code: "destination_branch_has_history" } as const;
    }

    yield* sql`
      UPDATE changes SET branch_ref = ${input.branchRef}, updated_at = ${input.now}
      WHERE id = ${expected.id}
    `;
    const rebound = yield* getChangeById(sql, expected.id);
    if (rebound === undefined) return yield* invalidData("Change disappeared during capture");
    return { ok: true, change: rebound } as const;
  });

const assignBase = (
  sql: SqlClient.SqlClient,
  change: CandidateCaptureChange,
  input: CommitCandidateCaptureInput,
) => {
  if (change.baseRef !== null) {
    return Effect.succeed(
      change.baseRef === input.selectedBaseRef
        ? ({ ok: true } as const)
        : ({ ok: false, code: "base_ref_conflict" } as const),
    );
  }
  return Effect.as(
    sql`
      UPDATE changes SET base_ref = ${input.selectedBaseRef}, updated_at = ${input.now}
      WHERE id = ${change.id}
    `,
    { ok: true as const },
  );
};

const captureStoredCandidate = (
  sql: SqlClient.SqlClient,
  changeId: string,
  input: CommitCandidateCaptureInput,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredCandidate>`
      SELECT id, selected_base_ref AS selectedBaseRef,
        resolved_target_sha AS resolvedTargetSha
      FROM candidates
      WHERE change_id = ${changeId}
        AND comparison_base_sha = ${input.comparisonBaseSha}
        AND head_sha = ${input.headSha}
    `;
    const existing = rows[0];
    if (existing !== undefined) return reuseStoredCandidate(existing, input);

    const candidateId = randomUUID();
    yield* sql`
      INSERT INTO candidates (
        id, change_id, selected_base_ref, resolved_target_sha,
        comparison_base_sha, head_sha, created_at
      ) VALUES (
        ${candidateId}, ${changeId}, ${input.selectedBaseRef}, ${input.resolvedTargetSha},
        ${input.comparisonBaseSha}, ${input.headSha}, ${input.now}
      )
    `;
    return { ok: true, candidateId, reused: false } as const;
  });

const reuseStoredCandidate = (
  existing: StoredCandidate,
  input: CommitCandidateCaptureInput,
): { readonly ok: true; readonly candidateId: string; readonly reused: true } | CommitRejection =>
  existing.selectedBaseRef === input.selectedBaseRef &&
  existing.resolvedTargetSha === input.resolvedTargetSha
    ? { ok: true, candidateId: existing.id, reused: true }
    : { ok: false, code: "candidate_provenance_conflict" };

const getChangeById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.map(
    sql<CandidateCaptureChange>`
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE id = ${changeId}
    `,
    (rows) => rows[0],
  );

const getChangeByBranch = (
  sql: SqlClient.SqlClient,
  repositoryCommonDirectory: string,
  branchRef: string,
) =>
  Effect.map(
    sql<CandidateCaptureChange>`
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE repository_common_directory = ${repositoryCommonDirectory}
        AND branch_ref = ${branchRef}
    `,
    (rows) => rows[0],
  );

const invalidData = (message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName: "commit Candidate capture",
      cause: new Error(message),
    }),
  );
