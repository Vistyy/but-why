import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import {
  createChange,
  insertLinkedChange,
  readChangeStartById,
  recordPrepareOutcome,
} from "../../../sqlite/sqliteChangeStartPersistence.js";
import {
  decodePersisted,
  decodeTaskContextRow,
  decodeTaskDependencyFacts,
  decodeTaskState,
  type StoredTaskContextRow,
  type StoredTaskDependencyFactRow,
} from "../../../sqlite/sqliteTaskReadModel.js";
import { storedPublicTaskId } from "../../../task/taskId.js";
import type {
  TaskChangeStartCreateInput,
  TaskChangeStartCreationInput,
  TaskChangeStartPersistence,
} from "../../taskChangeStart.js";

export const openSqliteTaskChangeStartPersistence = (): Effect.Effect<
  TaskChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    create: (input: TaskChangeStartCreateInput) =>
      repository.transactionImmediate("create Change Start", (sql) =>
        input.taskId === undefined
          ? createChange(sql, input)
          : createLinked(sql, { ...input, taskId: input.taskId }),
      ),
    prepareTask: (taskId) =>
      repository.transaction("prepare Change Start linked to a Task", (sql) =>
        prepareTask(sql, taskId),
      ),
    createLinked: (input) =>
      repository.transactionImmediate("create linked Change Start", (sql) =>
        createLinked(sql, input),
      ),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) => readChangeStartById(sql, changeId)),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        recordPrepareOutcome(sql, changeId, failure, now),
      ),
  }));

const prepareTask = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const task = yield* readTaskContext(sql, taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const existing = yield* readExistingByTaskId(sql, taskId);
    if (existing !== undefined) return { ok: true as const, existing, task };
    const dependencyRows = yield* sql<StoredTaskDependencyFactRow>`
      SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
      FROM task_dependencies
      LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId}
      ORDER BY tasks.numeric_id ASC
    `;
    const blockedBy = (yield* decodePersisted("prepare Change Start linked to a Task", () =>
      decodeTaskDependencyFacts(dependencyRows, storedPublicTaskId(taskId)),
    )).filter((dependency) => dependency.state !== "done");
    return blockedBy.length === 0
      ? { ok: true as const, existing: undefined, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const createLinked = (sql: SqlClient.SqlClient, input: TaskChangeStartCreationInput) =>
  Effect.gen(function* () {
    const prepared = yield* prepareTask(sql, input.taskId);
    if (!prepared.ok) return prepared;
    if (prepared.existing !== undefined) {
      return { ok: false as const, code: "change_start_conflict" as const };
    }
    const inserted = yield* insertLinkedChange(sql, input, {
      version: 1,
      title: prepared.task.title,
      description: prepared.task.description,
    });
    if (!inserted.ok) return inserted;
    yield* sql`
      INSERT INTO task_change_links (task_id, change_id)
      VALUES (${input.taskId}, ${input.id})
    `;
    const change = yield* readChangeStartById(sql, input.id);
    if (change === undefined) {
      return yield* invalidData("create linked Change Start", "Change disappeared");
    }
    return { ok: true as const, change };
  });

const readExistingByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly changeId: string }>`
      SELECT change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${taskId}
    `;
    const changeId = rows[0]?.changeId;
    return changeId === undefined ? undefined : yield* readChangeStartById(sql, changeId);
  });

const readTaskContext = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskContextRow & { readonly state: unknown }>`
      SELECT id, title, description, state FROM tasks WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted("prepare Change Start linked to a Task", () => ({
      ...decodeTaskContextRow(row),
      state: decodeTaskState(row.state),
    }));
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
