import type { DatabaseSync } from "node:sqlite";

import type { ChangePrepareFailure } from "../change/change.js";
import type {
  ChangeStartRecord,
  ChangeStartStore,
  CreateChangeStartInput,
} from "../change/changeStartStore.js";
import type { TaskDependencyFact } from "../task/task.js";
import type { TaskState } from "../task/lifecycle.js";
import { storedPublicTaskId, type PublicTaskId } from "../task/taskId.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "./sqliteChangePreparation.js";
import {
  decodeSqliteTaskContextSnapshot,
  encodeSqliteTaskContextSnapshot,
} from "./sqliteTaskContextSnapshot.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import { queryAll, queryOne } from "./query.js";

const columns = [
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

export const openSqliteChangeStartStore = (input: SqliteStoreInput): ChangeStartStore => ({
  prepareTask: (taskId) => withStateDatabase(input, (database) => prepareTask(database, taskId)),
  create: (createInput) => withStateDatabase(input, (database) => create(database, createInput)),
  getById: (changeId) => withStateDatabase(input, (database) => getById(database, changeId)),
  markReady: (changeId, now) =>
    withStateDatabase(input, (database) => markReady(database, changeId, now)),
  markPrepareFailed: (changeId, failure, now) =>
    withStateDatabase(input, (database) => markPrepareFailed(database, changeId, failure, now)),
});

const prepareTask = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): ReturnType<ChangeStartStore["prepareTask"]> => {
  const existing = getByTaskId(database, taskId);
  if (existing !== undefined) {
    const task = readTask(database, taskId);
    if (task === undefined) return { ok: false, code: "task_not_found" };
    return task.state === "implementing"
      ? { ok: true, existing }
      : { ok: false, code: "invalid_task_state", state: task.state };
  }
  const eligibility = readEligibility(database, taskId);
  return eligibility.ok ? { ok: true, existing: undefined } : eligibility;
};

const create = (
  database: DatabaseSync,
  input: CreateChangeStartInput,
): ReturnType<ChangeStartStore["create"]> => {
  database.exec("BEGIN IMMEDIATE");
  try {
    if (
      queryOne(
        database,
        "SELECT id FROM changes WHERE id = ? OR (repository_common_directory = ? AND branch_ref = ?) OR worktree_path = ?",
        [input.id, input.repositoryCommonDirectory, input.branchRef, input.worktreePath],
      ) !== undefined
    ) {
      database.exec("ROLLBACK");
      return { ok: false, code: "change_start_conflict" };
    }

    let acceptanceContext: TaskContextSnapshotV1 | null = null;
    if (input.taskId !== undefined) {
      const eligibility = readEligibility(database, input.taskId);
      if (!eligibility.ok) {
        database.exec("ROLLBACK");
        return eligibility;
      }
      if (getByTaskId(database, input.taskId) !== undefined) {
        database.exec("ROLLBACK");
        return { ok: false, code: "change_start_conflict" };
      }
      const comments = queryAll<{ readonly content: string }>(
        database,
        "SELECT content FROM task_comments WHERE task_id = ? ORDER BY sequence ASC",
        [input.taskId],
      ).map((row) => row.content);
      acceptanceContext = {
        version: 1,
        title: eligibility.task.title,
        description: eligibility.task.description,
        comments,
      };
    }

    database
      .prepare(`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, base_ref, task_id,
          starting_commit, worktree_path, acceptance_context, readiness,
          prepare_command, prepare_timeout_seconds, prepare_failure,
          state, close_reason, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, 'open', NULL, ?, ?, NULL)
      `)
      .run(
        input.id,
        input.repositoryCommonDirectory,
        input.branchRef,
        input.baseRef,
        input.taskId ?? null,
        input.startingCommit,
        input.worktreePath,
        acceptanceContext === null ? null : encodeSqliteTaskContextSnapshot(acceptanceContext),
        input.prepare?.command ?? null,
        input.prepare?.timeoutSeconds ?? null,
        input.now,
        input.now,
      );
    if (input.taskId !== undefined) {
      database
        .prepare("UPDATE tasks SET state = 'implementing', updated_at = ? WHERE id = ?")
        .run(input.now, input.taskId);
    }
    const change = getById(database, input.id);
    if (change === undefined) throw new Error("Change disappeared during Change Start");
    database.exec("COMMIT");
    return { ok: true, change };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const readEligibility = (
  database: DatabaseSync,
  taskId: PublicTaskId,
):
  | { readonly ok: true; readonly task: TaskRow }
  | Exclude<ReturnType<ChangeStartStore["prepareTask"]>, { readonly ok: true }> => {
  const task = readTask(database, taskId);
  if (task === undefined) return { ok: false, code: "task_not_found" };
  if (task.state !== "todo") {
    return { ok: false, code: "invalid_task_state", state: task.state };
  }
  const blockedBy = queryAll<TaskDependencyFact>(
    database,
    `
      SELECT tasks.id, tasks.title, tasks.state
      FROM task_dependencies
      JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ? AND tasks.state <> 'done'
      ORDER BY tasks.numeric_id ASC
    `,
    [taskId],
  );
  return blockedBy.length === 0
    ? { ok: true, task }
    : { ok: false, code: "task_dependencies_unsatisfied", blockedBy };
};

const readTask = (database: DatabaseSync, taskId: PublicTaskId): TaskRow | undefined =>
  queryOne<TaskRow>(database, "SELECT id, title, description, state FROM tasks WHERE id = ?", [
    taskId,
  ]);

const markReady = (database: DatabaseSync, changeId: string, now: string): ChangeStartRecord => {
  database
    .prepare(
      "UPDATE changes SET readiness = 'ready', prepare_failure = NULL, updated_at = ? WHERE id = ?",
    )
    .run(now, changeId);
  const change = getById(database, changeId);
  if (change === undefined) throw new Error("Change was not found while marking it ready");
  return change;
};

const markPrepareFailed = (
  database: DatabaseSync,
  changeId: string,
  failure: ChangePrepareFailure,
  now: string,
): ChangeStartRecord => {
  database
    .prepare(
      "UPDATE changes SET readiness = 'prepare_failed', prepare_failure = ?, updated_at = ? WHERE id = ?",
    )
    .run(encodeSqliteChangePrepareFailure(failure), now, changeId);
  const change = getById(database, changeId);
  if (change === undefined) throw new Error("Change was not found while recording preparation");
  return change;
};

const getByTaskId = (database: DatabaseSync, taskId: PublicTaskId): ChangeStartRecord | undefined =>
  mapRow(
    queryOne<ChangeStartRow>(database, `SELECT ${columns} FROM changes WHERE task_id = ?`, [
      taskId,
    ]),
  );

const getById = (database: DatabaseSync, changeId: string): ChangeStartRecord | undefined =>
  mapRow(
    queryOne<ChangeStartRow>(database, `SELECT ${columns} FROM changes WHERE id = ?`, [changeId]),
  );

const mapRow = (row: ChangeStartRow | undefined): ChangeStartRecord | undefined => {
  if (
    row === undefined ||
    row.baseRef === null ||
    row.startingCommit === null ||
    row.worktreePath === null ||
    row.readiness === null
  ) {
    return undefined;
  }
  return {
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
};

type TaskRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: TaskState;
};

type ChangeStartRow = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly taskId: string | null;
  readonly startingCommit: string | null;
  readonly worktreePath: string | null;
  readonly acceptanceContext: string | null;
  readonly readiness: ChangeStartRecord["readiness"] | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
  readonly state: ChangeStartRecord["state"];
  readonly closeReason: ChangeStartRecord["closeReason"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
} & SqliteChangePublicationRow;
