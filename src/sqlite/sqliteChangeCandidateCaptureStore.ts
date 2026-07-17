import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  ChangeCandidateCaptureStore,
  CommitCandidateCaptureInput,
  CommitCandidateCaptureResult,
} from "../changeCandidateCapture/changeCandidateCaptureStore.js";
import {
  rollbackIfOpen,
  validateStateDatabase,
  withStateDatabase,
  type SqliteStoreInput,
} from "./connection.js";
import { queryOne } from "./query.js";

type StoredChange = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly state: "open" | "closed";
};

type StoredCandidate = {
  readonly id: string;
  readonly selectedBaseRef: string;
  readonly resolvedTargetSha: string;
};

type CommitRejection = Extract<CommitCandidateCaptureResult, { readonly ok: false }>;

export const validateChangeCandidateCaptureState = validateStateDatabase;

export const openSqliteChangeCandidateCaptureStore = (
  input: SqliteStoreInput,
): ChangeCandidateCaptureStore => ({
  commitCapture: (captureInput) =>
    withStateDatabase(input, (database) => commitCapture(database, captureInput)),
});

const commitCapture = (
  database: DatabaseSync,
  input: CommitCandidateCaptureInput,
): CommitCandidateCaptureResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const selected = selectStoredChange(database, input);
    if (!selected.ok) return rollback(database, selected);
    const baseAssignment = assignBase(database, selected.change, input);
    if (!baseAssignment.ok) return rollback(database, baseAssignment);
    const candidate = captureStoredCandidate(database, selected.change.id, input);
    if (!candidate.ok) return rollback(database, candidate);

    database.exec("COMMIT");
    return {
      ok: true,
      changeId: selected.change.id,
      candidateId: candidate.candidateId,
      reused: candidate.reused,
    };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const selectStoredChange = (
  database: DatabaseSync,
  input: CommitCandidateCaptureInput,
): { readonly ok: true; readonly change: StoredChange } | CommitRejection => {
  const destination = getChangeByBranch(database, input.repositoryCommonDirectory, input.branchRef);
  return input.expectedChangeId === undefined
    ? createStoredChange(database, input, destination)
    : selectExpectedChange(database, input.expectedChangeId, input, destination);
};

const createStoredChange = (
  database: DatabaseSync,
  input: CommitCandidateCaptureInput,
  destination: StoredChange | undefined,
): { readonly ok: true; readonly change: StoredChange } | CommitRejection => {
  if (destination !== undefined) return { ok: false, code: "destination_branch_has_history" };
  const changeId = randomUUID();
  database
    .prepare(`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, base_ref, task_id, state,
        close_reason, created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, NULL, NULL, 'open', NULL, ?, ?, NULL)
    `)
    .run(changeId, input.repositoryCommonDirectory, input.branchRef, input.now, input.now);
  const change = getChangeById(database, changeId);
  if (change === undefined) throw new Error("Change disappeared after capture creation");
  return { ok: true, change };
};

const selectExpectedChange = (
  database: DatabaseSync,
  expectedChangeId: string,
  input: CommitCandidateCaptureInput,
  destination: StoredChange | undefined,
): { readonly ok: true; readonly change: StoredChange } | CommitRejection => {
  const expected = getChangeById(database, expectedChangeId);
  if (expected === undefined) return { ok: false, code: "change_not_found" };
  if (expected.state === "closed") return { ok: false, code: "change_closed" };
  if (expected.repositoryCommonDirectory !== input.repositoryCommonDirectory) {
    return { ok: false, code: "change_binding_conflict" };
  }
  if (expected.branchRef === input.branchRef) {
    return destination?.id === expected.id
      ? { ok: true, change: expected }
      : { ok: false, code: "change_binding_conflict" };
  }
  if (input.rebindFromRef !== expected.branchRef) {
    return { ok: false, code: "change_binding_conflict" };
  }
  if (destination !== undefined) return { ok: false, code: "destination_branch_has_history" };

  database
    .prepare("UPDATE changes SET branch_ref = ?, updated_at = ? WHERE id = ?")
    .run(input.branchRef, input.now, expected.id);
  const rebound = getChangeById(database, expected.id);
  if (rebound === undefined) throw new Error("Change disappeared during capture");
  return { ok: true, change: rebound };
};

const assignBase = (
  database: DatabaseSync,
  change: StoredChange,
  input: CommitCandidateCaptureInput,
): { readonly ok: true } | CommitRejection => {
  if (change.baseRef !== null) {
    return change.baseRef === input.selectedBaseRef
      ? { ok: true }
      : { ok: false, code: "base_ref_conflict" };
  }
  database
    .prepare("UPDATE changes SET base_ref = ?, updated_at = ? WHERE id = ?")
    .run(input.selectedBaseRef, input.now, change.id);
  return { ok: true };
};

const captureStoredCandidate = (
  database: DatabaseSync,
  changeId: string,
  input: CommitCandidateCaptureInput,
):
  | { readonly ok: true; readonly candidateId: string; readonly reused: boolean }
  | CommitRejection => {
  const existing = queryOne<StoredCandidate>(
    database,
    `
      SELECT id, selected_base_ref AS selectedBaseRef,
        resolved_target_sha AS resolvedTargetSha
      FROM candidates
      WHERE change_id = ? AND comparison_base_sha = ? AND head_sha = ?
    `,
    [changeId, input.comparisonBaseSha, input.headSha],
  );
  if (existing !== undefined) return reuseStoredCandidate(existing, input);

  const candidateId = randomUUID();
  database
    .prepare(`
      INSERT INTO candidates (
        id, change_id, selected_base_ref, resolved_target_sha,
        comparison_base_sha, head_sha, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      candidateId,
      changeId,
      input.selectedBaseRef,
      input.resolvedTargetSha,
      input.comparisonBaseSha,
      input.headSha,
      input.now,
    );
  return { ok: true, candidateId, reused: false };
};

const reuseStoredCandidate = (
  existing: StoredCandidate,
  input: CommitCandidateCaptureInput,
): { readonly ok: true; readonly candidateId: string; readonly reused: true } | CommitRejection =>
  existing.selectedBaseRef === input.selectedBaseRef &&
  existing.resolvedTargetSha === input.resolvedTargetSha
    ? { ok: true, candidateId: existing.id, reused: true }
    : { ok: false, code: "candidate_provenance_conflict" };

const rollback = (database: DatabaseSync, rejection: CommitRejection): CommitRejection => {
  database.exec("ROLLBACK");
  return rejection;
};

const getChangeById = (database: DatabaseSync, changeId: string): StoredChange | undefined =>
  queryOne<StoredChange>(
    database,
    `
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE id = ?
    `,
    [changeId],
  );

const getChangeByBranch = (
  database: DatabaseSync,
  repositoryCommonDirectory: string,
  branchRef: string,
): StoredChange | undefined =>
  queryOne<StoredChange>(
    database,
    `
      SELECT id, repository_common_directory AS repositoryCommonDirectory,
        branch_ref AS branchRef, base_ref AS baseRef, state
      FROM changes
      WHERE repository_common_directory = ? AND branch_ref = ?
    `,
    [repositoryCommonDirectory, branchRef],
  );
