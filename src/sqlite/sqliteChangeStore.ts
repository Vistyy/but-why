import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { changeState, type ChangePublication, type ChangeRecord } from "../change/change.js";
import type {
  ChangeStore,
  BeginChangePublicationInput,
  BeginChangePublicationResult,
  CloseChangeInput,
  CloseChangeResult,
  CreateChangeInput,
  CreateChangeResult,
  RecordPublishedPullRequestInput,
  RecordPublishedPullRequestResult,
} from "../change/changeStore.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import { decodeSqliteTaskContextSnapshot } from "./sqliteTaskContextSnapshot.js";
import { queryOne } from "./query.js";

const changeColumns = [
  "id",
  "repository_common_directory AS repositoryCommonDirectory",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "task_id AS taskId",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
  "readiness",
  "prepare_command AS prepareCommand",
  "prepare_timeout_seconds AS prepareTimeoutSeconds",
  "prepare_failure AS prepareFailure",
  "publication_candidate_id AS publicationCandidateId",
  "publication_validation_run_id AS publicationValidationRunId",
  "publication_owner AS publicationOwner",
  "publication_repo AS publicationRepo",
  "publication_base_branch AS publicationBaseBranch",
  "publication_remote_name AS publicationRemoteName",
  "publication_head_branch AS publicationHeadBranch",
  "publication_expected_head_sha AS publicationExpectedHeadSha",
  "publication_pr_number AS publicationPrNumber",
  "publication_pr_url AS publicationPrUrl",
  "state",
  "close_reason AS closeReason",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
  "closed_at AS closedAt",
].join(", ");

export const openSqliteChangeStore = (input: SqliteStoreInput): ChangeStore => ({
  createChange: (changeInput) =>
    withStateDatabase(input, (database) => createChange(database, changeInput)),
  getChangeById: (changeId) =>
    withStateDatabase(input, (database) => getChangeById(database, changeId)),
  getChangeByRepositoryBranch: (repositoryCommonDirectory, branchRef) =>
    withStateDatabase(input, (database) =>
      getChangeByRepositoryBranch(database, repositoryCommonDirectory, branchRef),
    ),
  closeChange: (closeInput) =>
    withStateDatabase(input, (database) => closeChange(database, closeInput)),
  beginPublication: (publicationInput) =>
    withStateDatabase(input, (database) => beginPublication(database, publicationInput)),
  recordPublishedPullRequest: (publicationInput) =>
    withStateDatabase(input, (database) => recordPublishedPullRequest(database, publicationInput)),
});

const createChange = (database: DatabaseSync, input: CreateChangeInput): CreateChangeResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const existingBranch = queryOne<{ readonly id: string }>(
      database,
      `
        SELECT id
        FROM changes
        WHERE repository_common_directory = ? AND branch_ref = ?
      `,
      [input.repositoryCommonDirectory, input.branchRef],
    );

    if (existingBranch !== undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "repository_branch_already_linked" };
    }

    const id = randomUUID();
    database
      .prepare(`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, 'open', NULL, ?, ?, NULL)
      `)
      .run(id, input.repositoryCommonDirectory, input.branchRef, null, input.now, input.now);

    const change = getChangeById(database, id);
    if (change === undefined) throw new Error("Change disappeared after creation");

    database.exec("COMMIT");
    return { ok: true, change };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const beginPublication = (
  database: DatabaseSync,
  input: BeginChangePublicationInput,
): BeginChangePublicationResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const change = getChangeById(database, input.changeId);
    if (change === undefined) return rollback(database, { ok: false, code: "change_not_found" });
    if (change.state === changeState.closed) {
      return rollback(database, { ok: false, code: "change_closed" });
    }
    if (change.publication !== null) {
      const samePendingPublication =
        change.publication.pullRequest === null &&
        change.publication.candidateId === input.candidateId &&
        change.publication.validationRunId === input.validationRunId &&
        sameTarget(change.publication.target, input.target) &&
        change.publication.headBranch === input.headBranch &&
        change.publication.expectedHeadSha === input.expectedHeadSha;
      database.exec("COMMIT");
      return samePendingPublication
        ? { ok: true, created: false, change }
        : { ok: false, code: "publication_already_owned" };
    }

    database
      .prepare(`
        UPDATE changes
        SET publication_candidate_id = ?, publication_validation_run_id = ?,
            publication_owner = ?, publication_repo = ?, publication_base_branch = ?,
            publication_remote_name = ?, publication_head_branch = ?,
            publication_expected_head_sha = ?, publication_pr_number = NULL,
            publication_pr_url = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.candidateId,
        input.validationRunId,
        input.target.owner,
        input.target.repo,
        input.target.baseBranch,
        input.target.remoteName,
        input.headBranch,
        input.expectedHeadSha,
        input.now,
        input.changeId,
      );
    const updated = getChangeById(database, input.changeId);
    if (updated === undefined) throw new Error("Change disappeared while publication started");
    database.exec("COMMIT");
    return { ok: true, created: true, change: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordPublishedPullRequest = (
  database: DatabaseSync,
  input: RecordPublishedPullRequestInput,
): RecordPublishedPullRequestResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const change = getChangeById(database, input.changeId);
    if (change === undefined) return rollback(database, { ok: false, code: "change_not_found" });
    if (change.state === changeState.closed) {
      return rollback(database, { ok: false, code: "change_closed" });
    }
    if (
      change.publication === null ||
      !sameTarget(change.publication.target, input.target) ||
      change.publication.headBranch !== input.headBranch ||
      (input.previousExpectedHeadSha !== undefined &&
        change.publication.expectedHeadSha !== input.previousExpectedHeadSha)
    ) {
      return rollback(database, { ok: false, code: "publication_state_conflict" });
    }

    database
      .prepare(`
        UPDATE changes
        SET publication_candidate_id = ?, publication_validation_run_id = ?,
            publication_expected_head_sha = ?, publication_pr_number = ?,
            publication_pr_url = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.candidateId,
        input.validationRunId,
        input.expectedHeadSha,
        input.pullRequest.number,
        input.pullRequest.url,
        input.now,
        input.changeId,
      );
    const updated = getChangeById(database, input.changeId);
    if (updated === undefined) throw new Error("Change disappeared while publication completed");
    database.exec("COMMIT");
    return { ok: true, change: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const closeChange = (database: DatabaseSync, input: CloseChangeInput): CloseChangeResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const change = getChangeById(database, input.changeId);
    if (change === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "change_not_found" };
    }
    if (change.state === changeState.closed) {
      database.exec("COMMIT");
      if (change.closeReason === input.reason) {
        return { ok: true, changed: false, change };
      }
      if (change.closeReason === null) throw new Error("Closed Change has no close reason");
      return { ok: false, code: "change_already_closed", reason: change.closeReason };
    }

    database
      .prepare(`
        UPDATE changes
        SET state = 'closed', close_reason = ?, updated_at = ?, closed_at = ?
        WHERE id = ? AND state = 'open'
      `)
      .run(input.reason, input.now, input.now, input.changeId);
    const updated = getChangeById(database, input.changeId);
    if (updated === undefined) throw new Error("Change disappeared after closure");

    database.exec("COMMIT");
    return { ok: true, changed: true, change: updated };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const getChangeById = (database: DatabaseSync, changeId: string): ChangeRecord | undefined =>
  mapChangeRow(
    queryOne<ChangeRow>(database, `SELECT ${changeColumns} FROM changes WHERE id = ?`, [changeId]),
  );

const getChangeByRepositoryBranch = (
  database: DatabaseSync,
  repositoryCommonDirectory: string,
  branchRef: string,
): ChangeRecord | undefined =>
  mapChangeRow(
    queryOne<ChangeRow>(
      database,
      `SELECT ${changeColumns} FROM changes WHERE repository_common_directory = ? AND branch_ref = ?`,
      [repositoryCommonDirectory, branchRef],
    ),
  );

const mapChangeRow = (row: ChangeRow | undefined): ChangeRecord | undefined =>
  row === undefined
    ? undefined
    : {
        id: row.id,
        repositoryCommonDirectory: row.repositoryCommonDirectory,
        branchRef: row.branchRef,
        baseRef: row.baseRef,
        taskId: row.taskId === null ? null : storedPublicTaskId(row.taskId),
        startingCommit: row.startingCommit,
        worktreePath: row.worktreePath,
        acceptanceContext:
          row.acceptanceContext === null
            ? null
            : decodeSqliteTaskContextSnapshot(row.acceptanceContext),
        readiness: row.readiness,
        prepare:
          row.prepareCommand === null || row.prepareTimeoutSeconds === null
            ? null
            : { command: row.prepareCommand, timeoutSeconds: row.prepareTimeoutSeconds },
        prepareFailure:
          row.prepareFailure === null ? null : decodeSqliteChangePrepareFailure(row.prepareFailure),
        publication: decodeSqliteChangePublication(row),
        state: row.state,
        closeReason: row.closeReason,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        closedAt: row.closedAt,
      };

type ChangeRow = Omit<
  ChangeRecord,
  "taskId" | "acceptanceContext" | "prepare" | "prepareFailure" | "publication"
> & {
  readonly taskId: string | null;
  readonly acceptanceContext: string | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
} & SqliteChangePublicationRow;

const sameTarget = (
  left: ChangePublication["target"],
  right: ChangePublication["target"],
): boolean =>
  left.owner === right.owner &&
  left.repo === right.repo &&
  left.baseBranch === right.baseBranch &&
  left.remoteName === right.remoteName;

const rollback = <Result>(database: DatabaseSync, result: Result): Result => {
  database.exec("ROLLBACK");
  return result;
};
