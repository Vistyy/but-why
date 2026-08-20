import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { completeMergedChange as completeChangeOnly } from "../../../sqlite/sqliteCompleteMergedChangeStorage.js";
import {
  completeTask,
  editTaskDependencies,
  getTaskById,
  renameTask,
  reviseTask,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
} from "../../../sqlite/sqliteTaskPersistence.js";
import { internalTaskId, publicTaskIdFromInternal } from "../../../task/taskId.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "../../../task/taskStore.js";
import { decideTaskCompletion, type TaskCompletionDecision } from "../../taskChange.js";
import type { TaskChangeLinkPort } from "../../taskChangePorts.js";

type TaskChangeTaskPersistence = {
  readonly editTaskDependencies: (
    input: EditTaskDependenciesInput,
  ) => Effect.Effect<EditTaskDependenciesResult, RepositoryStorageError>;
  readonly renameTask: (
    input: RenameTaskInput,
  ) => Effect.Effect<RenameTaskResult, RepositoryStorageError>;
  readonly reviseTask: (
    input: ReviseTaskInput,
  ) => Effect.Effect<ReviseTaskResult, RepositoryStorageError>;
};

export const openSqliteTaskChangeLinkPort = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeLinkPort => ({
      getByTaskId: (taskId) =>
        repository.transaction("read Change link by Task", (sql) =>
          readTaskChangeLinkByTaskId(sql, taskId, repository.idPrefix),
        ),
      getByChangeId: (changeId) =>
        repository.transaction("read Task link by Change", (sql) =>
          readTaskChangeLinkByChangeId(sql, changeId, repository.idPrefix),
        ),
    }),
  );

export const openSqliteTaskChangeTaskPersistence = () =>
  Effect.map(
    RepositorySql,
    (repository): TaskChangeTaskPersistence => ({
      editTaskDependencies: (input) =>
        repository.transactionImmediate("edit Task dependencies", (sql) =>
          Effect.gen(function* () {
            const target = yield* validateTaskDependencyEditTarget(
              sql,
              input.taskId,
              repository.idPrefix,
            );
            if (!target.ok) return target;
            const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
            if (link !== undefined) {
              return {
                ok: false as const,
                code: "dependencies_locked" as const,
                state: target.task.state,
              };
            }
            return yield* editTaskDependencies(sql, input, repository.idPrefix);
          }),
        ),
      renameTask: (input) =>
        repository.transactionImmediate("rename Task", (sql) =>
          Effect.gen(function* () {
            const current = yield* getTaskById(sql, input.taskId, repository.idPrefix);
            if (current === undefined) {
              return { ok: false as const, code: "task_not_found" as const };
            }
            if (current.title === input.title) {
              return { ok: true as const, noOp: true, task: current };
            }
            const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
            if (link !== undefined) {
              return {
                ok: false as const,
                code: "task_change_linked" as const,
                changeId: link.changeId,
              };
            }
            return yield* renameTask(sql, input, repository.idPrefix);
          }),
        ),
      reviseTask: (input) =>
        repository.transactionImmediate("revise Task", (sql) =>
          Effect.gen(function* () {
            const current = yield* validateTaskRevisionTarget(
              sql,
              input.taskId,
              repository.idPrefix,
            );
            if (!current.ok) return current;
            const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
            if (link !== undefined) {
              return {
                ok: false as const,
                code: "task_change_linked" as const,
                changeId: link.changeId,
              };
            }
            return yield* reviseTask(sql, input, repository.idPrefix);
          }),
        ),
    }),
  );

export const completeLinkedChange = (
  sql: SqlClient.SqlClient,
  input: CompleteMergedChangeInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const link = yield* readTaskChangeLinkByChangeId(sql, input.changeId, idPrefix);
    let taskDecision: TaskCompletionDecision | undefined;
    if (link !== undefined) {
      const task = yield* getTaskById(sql, link.taskId, idPrefix);
      if (task === undefined) {
        return yield* Effect.fail(
          new RepositoryPersistedDataInvalid({
            operationName: "complete linked Change",
            cause: new Error("Linked Task was not found"),
          }),
        );
      }
      taskDecision = yield* Effect.succeed(decideTaskCompletion(task.state));
      if (!taskDecision.ok) {
        return { ok: false as const, code: "task_completion_rejected" as const };
      }
    }

    const result = yield* completeChangeOnly(sql, input, idPrefix);
    if (!result.ok) return result;
    if (link !== undefined && taskDecision?.state === "todo") {
      yield* completeTask(sql, link.taskId, input.now, idPrefix);
    }
    return result;
  });

export const readTaskChangeLinkByTaskId = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<{ readonly taskId: number; readonly changeId: number }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${internalTaskId(taskId, idPrefix)}
    `,
    (rows) =>
      Effect.succeed(
        rows[0] === undefined
          ? undefined
          : {
              taskId: publicTaskIdFromInternal(rows[0].taskId, idPrefix),
              changeId: publicChangeId(idPrefix, rows[0].changeId),
            },
      ),
  );

const readTaskChangeLinkByChangeId = (
  sql: SqlClient.SqlClient,
  changeId: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<{ readonly taskId: number; readonly changeId: number }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE change_id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      Effect.succeed(
        rows[0] === undefined
          ? undefined
          : {
              taskId: publicTaskIdFromInternal(rows[0].taskId, idPrefix),
              changeId: publicChangeId(idPrefix, rows[0].changeId),
            },
      ),
  );
