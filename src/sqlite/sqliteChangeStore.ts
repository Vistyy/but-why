import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ChangeRecord } from "../change/change.js";
import type {
  ChangeStore,
  CloseChangeInput,
  CloseChangeResult,
  CreateChangeInput,
  CreateChangeResult,
} from "../change/changeStore.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
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

    if (input.taskId !== undefined) {
      const task = queryOne<{ readonly id: string }>(
        database,
        "SELECT id FROM tasks WHERE id = ?",
        [input.taskId],
      );
      if (task === undefined) {
        database.exec("ROLLBACK");
        return { ok: false, code: "task_not_found" };
      }

      const existingTaskLink = queryOne<{ readonly id: string }>(
        database,
        "SELECT id FROM changes WHERE task_id = ?",
        [input.taskId],
      );
      if (existingTaskLink !== undefined) {
        database.exec("ROLLBACK");
        return { ok: false, code: "task_already_linked" };
      }
    }

    const id = randomUUID();
    database
      .prepare(`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, 'open', NULL, ?, ?, NULL)
      `)
      .run(
        id,
        input.repositoryCommonDirectory,
        input.branchRef,
        input.taskId ?? null,
        input.now,
        input.now,
      );

    const change = getChangeById(database, id);
    if (change === undefined) throw new Error("Change disappeared after creation");

    database.exec("COMMIT");
    return { ok: true, change };
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
    if (change.state === "closed") {
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
          row.acceptanceContext === null ? null : JSON.parse(row.acceptanceContext),
        readiness: row.readiness,
        prepare:
          row.prepareCommand === null || row.prepareTimeoutSeconds === null
            ? null
            : { command: row.prepareCommand, timeoutSeconds: row.prepareTimeoutSeconds },
        prepareFailure: row.prepareFailure === null ? null : JSON.parse(row.prepareFailure),
        state: row.state,
        closeReason: row.closeReason,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        closedAt: row.closedAt,
      };

type ChangeRow = Omit<
  ChangeRecord,
  "taskId" | "acceptanceContext" | "prepare" | "prepareFailure"
> & {
  readonly taskId: string | null;
  readonly acceptanceContext: string | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
};
