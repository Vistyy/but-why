import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { CandidateRecord } from "../candidate/candidate.js";
import type {
  CandidateStore,
  CaptureCandidateInput,
  CaptureCandidateResult,
} from "../candidate/candidateStore.js";
import {
  setCurrentCandidate,
  supersedeActiveCandidateValidationRuns,
} from "./sqliteCandidateValidationInternals.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";

const candidateColumns = [
  "id",
  "change_id AS changeId",
  "selected_base_ref AS selectedBaseRef",
  "resolved_target_sha AS resolvedTargetSha",
  "comparison_base_sha AS comparisonBaseSha",
  "head_sha AS headSha",
  "created_at AS createdAt",
].join(", ");

export const openSqliteCandidateStore = (input: SqliteStoreInput): CandidateStore => ({
  captureCandidate: (candidateInput) =>
    withStateDatabase(input, (database) => captureCandidate(database, candidateInput)),
  getCandidateById: (candidateId) =>
    withStateDatabase(input, (database) => getCandidateById(database, candidateId)),
  listCandidatesForChange: (changeId) =>
    withStateDatabase(input, (database) => listCandidatesForChange(database, changeId)),
});

const captureCandidate = (
  database: DatabaseSync,
  input: CaptureCandidateInput,
): CaptureCandidateResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const change = queryOne<{
      readonly state: "open" | "closed";
      readonly baseRef: string | null;
    }>(database, "SELECT state, base_ref AS baseRef FROM changes WHERE id = ?", [input.changeId]);
    if (change === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "change_not_found" };
    }
    if (change.state === "closed") {
      database.exec("ROLLBACK");
      return { ok: false, code: "change_closed" };
    }

    const existing = queryOne<CandidateRecord>(
      database,
      `
        SELECT ${candidateColumns}
        FROM candidates
        WHERE change_id = ? AND comparison_base_sha = ? AND head_sha = ?
      `,
      [input.changeId, input.comparisonBaseSha, input.headSha],
    );
    if (existing !== undefined) {
      if (
        existing.selectedBaseRef !== input.selectedBaseRef ||
        existing.resolvedTargetSha !== input.resolvedTargetSha
      ) {
        database.exec("ROLLBACK");
        return { ok: false, code: "candidate_provenance_conflict", candidate: existing };
      }
      assignInitialBase(database, input.changeId, change.baseRef, input.selectedBaseRef, input.now);
      setCurrentCandidate(database, input.changeId, existing.id, input.now, true);
      database.exec("COMMIT");
      return { ok: true, reused: true, candidate: existing };
    }

    if (change.baseRef !== null && change.baseRef !== input.selectedBaseRef) {
      database.exec("ROLLBACK");
      return { ok: false, code: "change_base_ref_conflict" };
    }
    assignInitialBase(database, input.changeId, change.baseRef, input.selectedBaseRef, input.now);

    const id = randomUUID();
    database
      .prepare(`
        INSERT INTO candidates (
          id, change_id, selected_base_ref, resolved_target_sha,
          comparison_base_sha, head_sha, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.changeId,
        input.selectedBaseRef,
        input.resolvedTargetSha,
        input.comparisonBaseSha,
        input.headSha,
        input.now,
      );
    supersedeActiveCandidateValidationRuns(database, input.changeId, input.now);
    setCurrentCandidate(database, input.changeId, id, input.now);
    const candidate = getCandidateById(database, id);
    if (candidate === undefined) throw new Error("Candidate disappeared after capture");

    database.exec("COMMIT");
    return { ok: true, reused: false, candidate };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const assignInitialBase = (
  database: DatabaseSync,
  changeId: string,
  currentBaseRef: string | null,
  selectedBaseRef: string,
  now: string,
): void => {
  if (currentBaseRef === null) {
    database
      .prepare("UPDATE changes SET base_ref = ?, updated_at = ? WHERE id = ?")
      .run(selectedBaseRef, now, changeId);
  }
};

const getCandidateById = (
  database: DatabaseSync,
  candidateId: string,
): CandidateRecord | undefined =>
  queryOne<CandidateRecord>(database, `SELECT ${candidateColumns} FROM candidates WHERE id = ?`, [
    candidateId,
  ]);

const listCandidatesForChange = (
  database: DatabaseSync,
  changeId: string,
): readonly CandidateRecord[] =>
  queryAll<CandidateRecord>(
    database,
    `
      SELECT ${candidateColumns}
      FROM candidates
      WHERE change_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [changeId],
  );
