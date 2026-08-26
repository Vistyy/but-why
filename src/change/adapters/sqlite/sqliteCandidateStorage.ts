import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { CandidateRecord } from "../../candidate/candidate.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";

export type StoredCandidateRow = {
  readonly id: number;
  readonly changeId: number;
  readonly changeBaseSha: string;
  readonly headSha: string;
};

type CandidateOwnerRow = StoredCandidateRow & { readonly storedChangeId: number | null };

export const candidateReadColumns = `
  candidate.id, candidate.change_id AS changeId, candidate.base_commit AS changeBaseSha,
  candidate.head_commit AS headSha
`;

export const decodeCandidate = (row: StoredCandidateRow, idPrefix: string): CandidateRecord => ({
  id: row.id,
  changeId: publicChangeId(idPrefix, row.changeId),
  changeBaseSha: row.changeBaseSha,
  headSha: row.headSha,
});

export const readCandidateById = (
  sql: SqlClient.SqlClient,
  candidateId: number,
  operationName: string,
  idPrefix: string,
) =>
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
      const candidate = decodeOwnedCandidate(row, idPrefix);
      if (candidate.id !== candidateId) throw new Error("Candidate identity does not match lookup");
      return candidate;
    });
  });

export const readCurrentCandidateForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.change_id = ?
       ORDER BY candidate.id DESC
       LIMIT 1`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted(operationName, () => decodeOwnedCandidate(row, idPrefix, changeId));
  });

export const readCandidatesForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM candidates AS candidate
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE candidate.change_id = ?
       ORDER BY candidate.id`,
      [internalChangeId(changeId, idPrefix)],
    );
    return yield* decodePersisted(operationName, () =>
      rows.map((row) => decodeOwnedCandidate(row, idPrefix, changeId)),
    );
  });

export const compareCandidatesAscending = (left: CandidateRecord, right: CandidateRecord): number =>
  left.id - right.id;

const decodeOwnedCandidate = (
  row: CandidateOwnerRow,
  idPrefix: string,
  expectedChangeId?: string,
): CandidateRecord => {
  const candidate = decodeCandidate(row, idPrefix);
  if (
    row.storedChangeId === null ||
    candidate.changeId !== publicChangeId(idPrefix, row.storedChangeId) ||
    (expectedChangeId !== undefined && candidate.changeId !== expectedChangeId)
  ) {
    throw new Error("Candidate belongs to another or unknown Change");
  }
  return candidate;
};
