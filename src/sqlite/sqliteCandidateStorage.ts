import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export type StoredCandidateRow = {
  readonly id: string;
  readonly changeId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly createdAt: string;
};

type CandidateOwnerRow = StoredCandidateRow & { readonly storedChangeId: string | null };

export const candidateReadColumns = `
  candidate.id, candidate.change_id AS changeId, candidate.change_base_sha AS changeBaseSha,
  candidate.head_sha AS headSha, candidate.created_at AS createdAt
`;

export const decodeCandidate = (row: StoredCandidateRow): CandidateRecord => ({
  id: row.id,
  changeId: row.changeId,
  changeBaseSha: row.changeBaseSha,
  headSha: row.headSha,
  createdAt: row.createdAt,
});

export const readCandidateById = (
  sql: SqlClient.SqlClient,
  candidateId: string,
  operationName: string,
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
      const candidate = decodeOwnedCandidate(row);
      if (candidate.id !== candidateId) throw new Error("Candidate identity does not match lookup");
      return candidate;
    });
  });

export const readCurrentCandidateForChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<CandidateOwnerRow>(
      `SELECT ${candidateReadColumns}, change_row.id AS storedChangeId
       FROM current_candidates AS selection
       JOIN candidates AS candidate ON candidate.id = selection.candidate_id
       LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
       WHERE selection.change_id = ?`,
      [changeId],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted(operationName, () => decodeOwnedCandidate(row, changeId));
  });

export const readCandidatesForChange = (
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

export const compareCandidatesAscending = (left: CandidateRecord, right: CandidateRecord): number =>
  compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);

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

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
