import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePrepareFailure } from "../change/change.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "../change/changeStartStore.js";
import type { TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import { storedPublicTaskId, type PublicTaskId } from "../task/taskId.js";
import type { TaskContextSnapshotV1 } from "../change/validationRun/taskContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import {
  decodeSqliteTaskContextSnapshot,
  encodeSqliteTaskContextSnapshot,
} from "./sqliteTaskContextSnapshot.js";

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
  "cleanup_state AS cleanupState",
  "cleanup_blocking_reason AS cleanupBlockingReason",
  "state",
  "close_reason AS closeReason",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
  "closed_at AS closedAt",
].join(", ");

export const openSqliteChangeStartPersistence = (): Effect.Effect<
  ChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    prepareTask: (taskId) =>
      repository.transaction("prepare Task-backed Change Start", (sql) => prepareTask(sql, taskId)),
    create: (input) =>
      repository.transactionImmediate("create Change Start", (sql) => create(sql, input)),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) => getById(sql, changeId)),
    markReady: (changeId, now) =>
      repository.transactionImmediate("mark Change ready", (sql) => markReady(sql, changeId, now)),
    markPrepareFailed: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation failure", (sql) =>
        markPrepareFailed(sql, changeId, failure, now),
      ),
  }));

const prepareTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const existing = yield* getByTaskId(sql, taskId);
    if (existing !== undefined) {
      const task = yield* readTask(sql, taskId);
      if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
      return task.state === "implementing"
        ? { ok: true as const, existing }
        : { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const eligibility = yield* readEligibility(sql, taskId);
    return eligibility.ok ? { ok: true as const, existing: undefined } : eligibility;
  });

const create = (sql: SqlClient.SqlClient, input: CreateChangeStartInput) =>
  Effect.gen(function* () {
    const conflicts = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes
      WHERE id = ${input.id}
        OR (repository_common_directory = ${input.repositoryCommonDirectory} AND branch_ref = ${input.branchRef})
        OR worktree_path = ${input.worktreePath}
      LIMIT 1
    `;
    if (conflicts.length > 0) {
      return { ok: false as const, code: "change_start_conflict" as const };
    }

    let acceptanceContext: TaskContextSnapshotV1 | null = null;
    if (input.taskId !== undefined) {
      const eligibility = yield* readEligibility(sql, input.taskId);
      if (!eligibility.ok) return eligibility;
      if ((yield* getByTaskId(sql, input.taskId)) !== undefined) {
        return { ok: false as const, code: "change_start_conflict" as const };
      }
      const comments = yield* sql<{ readonly content: string }>`
        SELECT content FROM task_comments
        WHERE task_id = ${input.taskId}
        ORDER BY sequence ASC
      `;
      acceptanceContext = {
        version: 1,
        title: eligibility.task.title,
        description: eligibility.task.description,
        comments: comments.map((row) => row.content),
      };
    }

    yield* sql`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, base_ref, task_id,
        starting_commit, worktree_path, acceptance_context, readiness,
        prepare_command, prepare_timeout_seconds, prepare_failure,
        state, close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.id}, ${input.repositoryCommonDirectory}, ${input.branchRef}, ${input.baseRef},
        ${input.taskId ?? null}, ${input.startingCommit}, ${input.worktreePath},
        ${acceptanceContext === null ? null : encodeSqliteTaskContextSnapshot(acceptanceContext)},
        'pending', ${input.prepare?.command ?? null}, ${input.prepare?.timeoutSeconds ?? null},
        NULL, 'open', NULL, ${input.now}, ${input.now}, NULL
      )
    `;
    if (input.taskId !== undefined) {
      yield* sql`
        UPDATE tasks SET state = 'implementing', updated_at = ${input.now}
        WHERE id = ${input.taskId}
      `;
    }
    const change = yield* getById(sql, input.id);
    if (change === undefined)
      return yield* invalidData("create Change Start", "Change disappeared");
    return { ok: true as const, change };
  });

const readEligibility = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const task = yield* readTask(sql, taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const blockedBy = yield* sql<TaskDependencyFact>`
      SELECT tasks.id, tasks.title, tasks.state
      FROM task_dependencies
      JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId} AND tasks.state <> 'done'
      ORDER BY tasks.numeric_id ASC
    `;
    return blockedBy.length === 0
      ? { ok: true as const, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const readTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<TaskRow>`SELECT id, title, description, state FROM tasks WHERE id = ${taskId}`,
    (rows) => rows[0],
  );

const markReady = (sql: SqlClient.SqlClient, changeId: string, now: string) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes SET readiness = 'ready', prepare_failure = NULL, updated_at = ${now}
      WHERE id = ${changeId}
    `;
    const change = yield* getById(sql, changeId);
    return change === undefined
      ? yield* invalidData("mark Change ready", "Change was not found")
      : change;
  });

const markPrepareFailed = (
  sql: SqlClient.SqlClient,
  changeId: string,
  failure: ChangePrepareFailure,
  now: string,
) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes SET readiness = 'prepare_failed',
        prepare_failure = ${encodeSqliteChangePrepareFailure(failure)}, updated_at = ${now}
      WHERE id = ${changeId}
    `;
    const change = yield* getById(sql, changeId);
    return change === undefined
      ? yield* invalidData("record Change preparation", "Change was not found")
      : change;
  });

const getByTaskId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql.unsafe<ChangeStartRow>(`SELECT ${columns} FROM changes WHERE task_id = ?`, [taskId]),
    (rows) => mapRow(rows[0]),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeStartRow>(`SELECT ${columns} FROM changes WHERE id = ?`, [changeId]),
    (rows) => mapRow(rows[0]),
  );

const mapRow = (row: ChangeStartRow | undefined) => {
  if (
    row === undefined ||
    row.baseRef === null ||
    row.startingCommit === null ||
    row.worktreePath === null ||
    row.readiness === null
  ) {
    return Effect.succeed(undefined);
  }
  const baseRef = row.baseRef;
  const startingCommit = row.startingCommit;
  const worktreePath = row.worktreePath;
  const readiness = row.readiness;
  return Effect.try({
    try: (): ChangeStartRecord => ({
      id: row.id,
      repositoryCommonDirectory: row.repositoryCommonDirectory,
      branchRef: row.branchRef,
      baseRef,
      taskId: row.taskId === null ? null : storedPublicTaskId(row.taskId),
      startingCommit,
      worktreePath,
      acceptanceContext:
        row.acceptanceContext === null
          ? null
          : decodeSqliteTaskContextSnapshot(row.acceptanceContext),
      readiness,
      prepare:
        row.prepareCommand === null || row.prepareTimeoutSeconds === null
          ? null
          : { command: row.prepareCommand, timeoutSeconds: row.prepareTimeoutSeconds },
      prepareFailure:
        row.prepareFailure === null ? null : decodeSqliteChangePrepareFailure(row.prepareFailure),
      publication: decodeSqliteChangePublication(row),
      cleanup: { state: row.cleanupState, blockingReason: row.cleanupBlockingReason },
      state: row.state,
      closeReason: row.closeReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      closedAt: row.closedAt,
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "read Change Start", cause }),
  });
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

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
  readonly cleanupState: ChangeStartRecord["cleanup"]["state"];
  readonly cleanupBlockingReason: string | null;
  readonly state: ChangeStartRecord["state"];
  readonly closeReason: ChangeStartRecord["closeReason"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
} & SqliteChangePublicationRow;
