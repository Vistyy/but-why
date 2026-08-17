import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type {
  CandidateCaptureChange,
  CandidateCapturePersistence,
  CommitCandidateCaptureInput,
} from "../change/candidateCapture/candidateCapturePersistence.js";
import { changeState } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  candidateReadColumns,
  decodeCandidate,
  type StoredCandidateRow,
} from "./sqliteCandidateStorage.js";
import {
  decodeCandidateCaptureChange,
  type StoredCandidateCaptureChangeRow,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteCandidateCapturePersistence = (): Effect.Effect<
  CandidateCapturePersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    getChangeById: (changeId) =>
      repository
        .operation("read Change for Candidate capture", (sql) =>
          readChangeById(sql, changeId, repository.idPrefix),
        )
        .pipe(Effect.flatMap((row) => decodeCandidateCaptureOptional(row, repository.idPrefix))),
    getChangeByRepositoryBranch: (repositoryCommonDirectory, branchRef) =>
      repository
        .operation("read Change branch for Candidate capture", (sql) =>
          readChangeByBranch(sql, repositoryCommonDirectory, branchRef),
        )
        .pipe(Effect.flatMap((row) => decodeCandidateCaptureOptional(row, repository.idPrefix))),
    commitCapture: (input) =>
      repository.transactionImmediate("commit Candidate capture", (sql) =>
        commitCapture(sql, input, repository.idPrefix),
      ),
  }));

const commitCapture = (
  sql: SqlClient.SqlClient,
  input: CommitCandidateCaptureInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const selected = yield* selectStoredChange(sql, input, idPrefix);
    if (!selected.ok) return selected;
    const baseAssignment = yield* assignBase(sql, selected.change, input, idPrefix);
    if (!baseAssignment.ok) return baseAssignment;
    const candidate = yield* captureStoredCandidate(sql, selected.change.id, input, idPrefix);
    yield* selectCurrentCandidate(sql, selected.change.id, candidate.candidateId, idPrefix);

    return {
      ok: true,
      changeId: selected.change.id,
      candidateId: candidate.candidateId,
      reused: candidate.reused,
    } as const;
  });

const selectStoredChange = (
  sql: SqlClient.SqlClient,
  input: CommitCandidateCaptureInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const destination = yield* getChangeByBranch(
      sql,
      input.repositoryCommonDirectory,
      input.branchRef,
      idPrefix,
    );
    return input.expectedChangeId === undefined
      ? yield* createStoredChange(sql, input, destination, idPrefix)
      : yield* selectExpectedChange(sql, input.expectedChangeId, input, destination, idPrefix);
  });

const createStoredChange = (
  sql: SqlClient.SqlClient,
  input: CommitCandidateCaptureInput,
  destination: CandidateCaptureChange | undefined,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    if (destination !== undefined) {
      return { ok: false, code: "destination_branch_has_history" } as const;
    }
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO changes (
        repository_common_directory, branch_ref, base_ref, state,
        close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.repositoryCommonDirectory}, ${input.branchRef}, NULL,
        'open', NULL, ${input.now}, ${input.now}, NULL
      )
      RETURNING id
    `;
    const allocatedId = inserted[0]?.id;
    if (allocatedId === undefined) return yield* invalidData("Change identity was not allocated");
    const change = yield* getChangeById(sql, publicChangeId(idPrefix, allocatedId), idPrefix);
    if (change === undefined)
      return yield* invalidData("Change disappeared after capture creation");
    return { ok: true, change } as const;
  });

const selectExpectedChange = (
  sql: SqlClient.SqlClient,
  expectedChangeId: string,
  input: CommitCandidateCaptureInput,
  destination: CandidateCaptureChange | undefined,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const expected = yield* getChangeById(sql, expectedChangeId, idPrefix);
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
      WHERE id = ${internalChangeId(expected.id, idPrefix)}
    `;
    const rebound = yield* getChangeById(sql, expected.id, idPrefix);
    if (rebound === undefined) return yield* invalidData("Change disappeared during capture");
    return { ok: true, change: rebound } as const;
  });

const assignBase = (
  sql: SqlClient.SqlClient,
  change: CandidateCaptureChange,
  input: CommitCandidateCaptureInput,
  idPrefix: string,
) => {
  if (change.baseRef !== null) {
    return Effect.succeed(
      change.baseRef === input.baseRef
        ? ({ ok: true } as const)
        : ({ ok: false, code: "base_ref_conflict" } as const),
    );
  }
  return Effect.as(
    sql`
      UPDATE changes SET base_ref = ${input.baseRef}, updated_at = ${input.now}
      WHERE id = ${internalChangeId(change.id, idPrefix)}
    `,
    { ok: true as const },
  );
};

const captureStoredCandidate = (
  sql: SqlClient.SqlClient,
  changeId: string,
  input: CommitCandidateCaptureInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCandidateRow>(
      `SELECT ${candidateReadColumns}
       FROM candidates AS candidate
       WHERE candidate.change_id = ?
         AND candidate.change_base_sha = ? AND candidate.head_sha = ?`,
      [internalChangeId(changeId, idPrefix), input.changeBaseSha, input.headSha],
    );
    const row = rows[0];
    if (row !== undefined) {
      const existing = yield* decodePersisted("commit Candidate capture", () => {
        const candidate = decodeCandidate(row, idPrefix);
        if (candidate.changeId !== changeId) {
          throw new Error("Candidate belongs to another Change");
        }
        if (
          candidate.changeBaseSha !== input.changeBaseSha ||
          candidate.headSha !== input.headSha
        ) {
          throw new Error("Candidate identity does not match capture");
        }
        return candidate;
      });
      return { ok: true, candidateId: existing.id, reused: true } as const;
    }

    const candidateId = randomUUID();
    yield* sql`
      INSERT INTO candidates (
        id, change_id, change_base_sha, head_sha, created_at
      ) VALUES (
        ${candidateId}, ${internalChangeId(changeId, idPrefix)}, ${input.changeBaseSha}, ${input.headSha}, ${input.now}
      )
    `;
    return { ok: true, candidateId, reused: false } as const;
  });

const selectCurrentCandidate = (
  sql: SqlClient.SqlClient,
  changeId: string,
  candidateId: string,
  idPrefix: string,
) =>
  sql`
    INSERT INTO current_candidates (change_id, candidate_id)
    VALUES (${internalChangeId(changeId, idPrefix)}, ${candidateId})
    ON CONFLICT (change_id) DO UPDATE SET candidate_id = excluded.candidate_id
  `;

const getChangeById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(readChangeById(sql, changeId, idPrefix), (row) =>
    decodeCandidateCaptureOptional(row, idPrefix),
  );

const readChangeById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.map(
    sql<StoredCandidateCaptureChangeRow>`
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) => rows[0],
  );

const getChangeByBranch = (
  sql: SqlClient.SqlClient,
  repositoryCommonDirectory: string,
  branchRef: string,
  idPrefix: string,
) =>
  Effect.flatMap(readChangeByBranch(sql, repositoryCommonDirectory, branchRef), (row) =>
    decodeCandidateCaptureOptional(row, idPrefix),
  );

const readChangeByBranch = (
  sql: SqlClient.SqlClient,
  repositoryCommonDirectory: string,
  branchRef: string,
) =>
  Effect.map(
    sql<StoredCandidateCaptureChangeRow>`
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE repository_common_directory = ${repositoryCommonDirectory}
        AND branch_ref = ${branchRef}
    `,
    (rows) => rows[0],
  );

const decodeCandidateCaptureOptional = (
  row: StoredCandidateCaptureChangeRow | undefined,
  idPrefix: string,
) => Effect.succeed(row === undefined ? undefined : decodeCandidateCaptureChange(row, idPrefix));

const invalidData = (message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName: "commit Candidate capture",
      cause: new Error(message),
    }),
  );
