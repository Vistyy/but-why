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
          readChangeById(sql, changeId, repository.commonDirectory, repository.idPrefix),
        )
        .pipe(Effect.flatMap((row) => decodeCandidateCaptureOptional(row, repository.idPrefix))),
    getChangeByRepositoryBranch: (repositoryCommonDirectory, branchRef) =>
      repositoryCommonDirectory !== repository.commonDirectory
        ? Effect.succeed(undefined)
        : repository
            .operation("read Change branch for Candidate capture", (sql) =>
              readChangeByBranch(sql, branchRef, repository.commonDirectory),
            )
            .pipe(
              Effect.flatMap((row) => decodeCandidateCaptureOptional(row, repository.idPrefix)),
            ),
    commitCapture: (input) =>
      input.repositoryCommonDirectory !== repository.commonDirectory
        ? Effect.succeed({ ok: false as const, code: "change_binding_conflict" as const })
        : repository.transactionImmediate("commit Candidate capture", (sql) =>
            commitCapture(sql, input, repository.commonDirectory, repository.idPrefix),
          ),
  }));

const commitCapture = (
  sql: SqlClient.SqlClient,
  input: CommitCandidateCaptureInput,
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const selected = yield* selectStoredChange(sql, input, repositoryCommonDirectory, idPrefix);
    if (!selected.ok) return selected;
    if (selected.change.baseRef !== input.baseRef) {
      return { ok: false, code: "base_ref_conflict" } as const;
    }
    const candidate = yield* captureStoredCandidate(sql, selected.change.id, input, idPrefix);
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
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const destination = yield* getChangeByBranch(
      sql,
      input.branchRef,
      repositoryCommonDirectory,
      idPrefix,
    );
    if (input.expectedChangeId === undefined) {
      if (destination === undefined) return { ok: false, code: "change_not_found" } as const;
      if (destination.state === changeState.closed) {
        return { ok: false, code: "change_closed" } as const;
      }
      return { ok: true, change: destination } as const;
    }
    return yield* selectExpectedChange(
      sql,
      input.expectedChangeId,
      input,
      destination,
      repositoryCommonDirectory,
      idPrefix,
    );
  });

const selectExpectedChange = (
  sql: SqlClient.SqlClient,
  expectedChangeId: string,
  input: CommitCandidateCaptureInput,
  destination: CandidateCaptureChange | undefined,
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const expected = yield* getChangeById(
      sql,
      expectedChangeId,
      repositoryCommonDirectory,
      idPrefix,
    );
    if (expected === undefined) return { ok: false, code: "change_not_found" } as const;
    if (expected.state === changeState.closed) return { ok: false, code: "change_closed" } as const;
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
      UPDATE changes SET branch_ref = ${input.branchRef}
      WHERE id = ${internalChangeId(expected.id, idPrefix)}
    `;
    const rebound = yield* getChangeById(sql, expected.id, repositoryCommonDirectory, idPrefix);
    if (rebound === undefined) return yield* invalidData("Change disappeared during capture");
    return { ok: true, change: rebound } as const;
  });

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
       ORDER BY candidate.id DESC
       LIMIT 1`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    if (row !== undefined) {
      const existing = yield* decodePersisted("commit Candidate capture", () =>
        decodeCandidate(row, idPrefix),
      );
      if (
        existing.changeId === changeId &&
        existing.changeBaseSha === input.changeBaseSha &&
        existing.headSha === input.headSha
      ) {
        return { candidateId: existing.id, reused: true } as const;
      }
    }

    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO candidates (change_id, base_commit, head_commit)
      VALUES (
        ${internalChangeId(changeId, idPrefix)}, ${input.changeBaseSha}, ${input.headSha}
      )
      RETURNING id
    `;
    const candidateId = inserted[0]?.id;
    if (candidateId === undefined)
      return yield* invalidData("Candidate identity was not allocated");
    return { candidateId, reused: false } as const;
  });

type StoredCandidateCaptureChangeRow = {
  readonly id: number;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string;
  readonly closeReason: string | null;
};

const getChangeById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.flatMap(readChangeById(sql, changeId, repositoryCommonDirectory, idPrefix), (row) =>
    decodeCandidateCaptureOptional(row, idPrefix),
  );

const readChangeById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.map(
    sql<StoredCandidateCaptureChangeRow>`
      SELECT id, ${repositoryCommonDirectory} AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, close_reason AS closeReason
      FROM changes
      WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) => rows[0],
  );

const getChangeByBranch = (
  sql: SqlClient.SqlClient,
  branchRef: string,
  repositoryCommonDirectory: string,
  idPrefix: string,
) =>
  Effect.flatMap(readChangeByBranch(sql, branchRef, repositoryCommonDirectory), (row) =>
    decodeCandidateCaptureOptional(row, idPrefix),
  );

const readChangeByBranch = (
  sql: SqlClient.SqlClient,
  branchRef: string,
  repositoryCommonDirectory: string,
) =>
  Effect.map(
    sql<StoredCandidateCaptureChangeRow>`
      SELECT id, ${repositoryCommonDirectory} AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, close_reason AS closeReason
      FROM changes
      WHERE branch_ref = ${branchRef}
    `,
    (rows) => rows[0],
  );

const decodeCandidateCaptureOptional = (
  row: StoredCandidateCaptureChangeRow | undefined,
  idPrefix: string,
) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodePersisted("read Change for Candidate capture", () => ({
        id: publicChangeId(idPrefix, row.id),
        repositoryCommonDirectory: row.repositoryCommonDirectory,
        branchRef: row.branchRef,
        baseRef: row.baseRef,
        state: row.closeReason === null ? changeState.open : changeState.closed,
      }));

const invalidData = (message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName: "commit Candidate capture",
      cause: new Error(message),
    }),
  );
