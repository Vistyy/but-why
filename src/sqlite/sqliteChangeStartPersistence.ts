import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePrepareFailure } from "../change/change.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type { CreateChangeStartInput } from "../change/changeStartStore.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { PublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import { encodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { encodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  changeReadColumns,
  decodeChangeRow,
  requireChangeStartRecord,
  type UnknownChangeRow,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  type DecodedTaskGraph,
  decodePersisted,
  readDecodedTaskGraph,
  taskDependencyFacts,
} from "./sqliteTaskReadModel.js";

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
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        recordPrepareOutcome(sql, changeId, failure, now),
      ),
  }));

const prepareTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const existing = yield* getByTaskId(sql, taskId);
    if (existing !== undefined) {
      const task = yield* readTask(sql, taskId);
      if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
      return task.state === "todo"
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

    let acceptanceContext: AcceptanceContextSnapshotV1 | null = null;
    if (input.taskId !== undefined) {
      const eligibility = yield* readEligibility(sql, input.taskId);
      if (!eligibility.ok) return eligibility;
      if ((yield* getByTaskId(sql, input.taskId)) !== undefined) {
        return { ok: false as const, code: "change_start_conflict" as const };
      }
      acceptanceContext = {
        version: 1,
        title: eligibility.task.title,
        description: eligibility.task.description,
      };
    }

    yield* sql`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, base_ref, base_remote_url, task_id,
        starting_commit, worktree_path, acceptance_context,
        prepare_command, prepare_timeout_seconds, prepare_failure,
        state, close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.id}, ${input.repositoryCommonDirectory}, ${input.branchRef}, ${input.baseRef},
        ${input.baseRemoteUrl}, ${input.taskId ?? null}, ${input.startingCommit}, ${input.worktreePath},
        ${acceptanceContext === null ? null : encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${input.prepare?.command ?? null}, ${input.prepare?.timeoutSeconds ?? null},
        NULL, 'open', NULL, ${input.now}, ${input.now}, NULL
      )
    `;
    const change = yield* getById(sql, input.id);
    if (change === undefined)
      return yield* invalidData("create Change Start", "Change disappeared");
    return { ok: true as const, change };
  });

const readEligibility = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const graph = yield* readDecodedTaskGraph(sql, "prepare Task-backed Change Start");
    const task = graph.tasksById.get(taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const blockedBy = taskDependencyFacts(graph, taskId, "prerequisites").filter(
      (dependency) => dependency.state !== "done",
    );
    return blockedBy.length === 0
      ? { ok: true as const, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const readTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    readDecodedTaskGraph(sql, "prepare Task-backed Change Start"),
    (graph: DecodedTaskGraph) => graph.tasksById.get(taskId),
  );

const recordPrepareOutcome = (
  sql: SqlClient.SqlClient,
  changeId: string,
  failure: ChangePrepareFailure | null,
  now: string,
) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes SET prepare_failure = ${failure === null ? null : encodeSqliteChangePrepareFailure(failure)}, updated_at = ${now}
      WHERE id = ${changeId}
    `;
    const change = yield* getById(sql, changeId);
    return change === undefined
      ? yield* invalidData("record Change preparation outcome", "Change was not found")
      : change;
  });

const getByTaskId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE task_id = ?`, [
      taskId,
    ]),
    (rows) => mapRow(rows[0], sql),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], sql),
  );

const mapRow = (row: UnknownChangeRow | undefined, sql: SqlClient.SqlClient) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const change = yield* decodePersisted("read Change Start", () =>
          requireChangeStartRecord(decodeChangeRow(row)),
        );
        yield* validateChangeRelationships(sql, change, "read Change Start");
        return change;
      });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
