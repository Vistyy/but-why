import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";

import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type { ChangeStartRecord } from "../../../change/changeStartStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  createChange,
  insertLinkedChange,
  readChangeStartById,
  recordPrepareOutcome as recordChangePrepareOutcome,
} from "../../../sqlite/sqliteChangeStartPersistence.js";
import type { TaskContext, TaskDependencyFact } from "../../../task/task.js";
import type { TaskState } from "../../../task/lifecycle.js";
import { internalTaskId, publicTaskId, type PublicTaskId } from "../../../task/taskId.js";
import type {
  TaskChangeStartCreateInput,
  TaskChangeStartCreationInput,
  TaskChangeStartPersistence,
} from "../../taskChangeStart.js";

export type TaskChangeStartTaskOperations = {
  readonly getTaskForChangeStart: (
    sql: SqlClient.SqlClient,
    taskId: PublicTaskId,
    idPrefix: string,
  ) => Effect.Effect<
    (TaskContext & { readonly state: TaskState }) | undefined,
    SqlError | RepositoryPersistedDataInvalid
  >;
  readonly getTaskDependenciesForChangeStart: (
    sql: SqlClient.SqlClient,
    taskId: PublicTaskId,
    idPrefix: string,
  ) => Effect.Effect<readonly TaskDependencyFact[], SqlError | RepositoryPersistedDataInvalid>;
};

export const openSqliteTaskChangeStartPersistence = (
  taskOperations: TaskChangeStartTaskOperations,
): Effect.Effect<TaskChangeStartPersistence, never, RepositorySql> =>
  Effect.map(RepositorySql, (repository) => ({
    create: (input: TaskChangeStartCreateInput) =>
      repository.transactionImmediate("create Change Start", (sql) =>
        input.taskId === undefined
          ? createChange(sql, input, repository.idPrefix)
          : createLinked(
              sql,
              { ...input, taskId: input.taskId },
              repository.idPrefix,
              taskOperations,
            ),
      ),
    prepareTask: (taskId) =>
      repository.transaction("prepare Change Start linked to a Task", (sql) =>
        prepareTask(sql, taskId, repository.idPrefix, taskOperations),
      ),
    createLinked: (input) =>
      repository.transactionImmediate("create linked Change Start", (sql) =>
        createLinked(sql, input, repository.idPrefix, taskOperations),
      ),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) =>
        readTaskChangeStartById(sql, changeId, repository.idPrefix),
      ),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        Effect.flatMap(
          recordChangePrepareOutcome(sql, changeId, failure, now, repository.idPrefix),
          (change) => validateTaskChangeStart(sql, change, repository.idPrefix),
        ),
      ),
  }));

const prepareTask = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
  taskOperations: TaskChangeStartTaskOperations,
) =>
  Effect.gen(function* () {
    const task = yield* taskOperations.getTaskForChangeStart(sql, publicTaskId(taskId), idPrefix);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const existing = yield* readExistingByTaskId(sql, taskId, idPrefix);
    if (existing !== undefined) return { ok: true as const, existing, task };
    const blockedBy = yield* taskOperations.getTaskDependenciesForChangeStart(
      sql,
      publicTaskId(taskId),
      idPrefix,
    );
    return blockedBy.length === 0
      ? { ok: true as const, existing: undefined, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const createLinked = (
  sql: SqlClient.SqlClient,
  input: TaskChangeStartCreationInput,
  idPrefix: string,
  taskOperations: TaskChangeStartTaskOperations,
) =>
  Effect.gen(function* () {
    const prepared = yield* prepareTask(sql, input.taskId, idPrefix, taskOperations);
    if (!prepared.ok) return prepared;
    if (prepared.existing !== undefined) {
      return { ok: false as const, code: "change_start_conflict" as const };
    }
    const inserted = yield* insertLinkedChange(
      sql,
      input,
      {
        version: 1,
        title: prepared.task.title,
        description: prepared.task.description,
      },
      idPrefix,
    );
    if (!inserted.ok) return inserted;
    yield* sql`
      INSERT INTO task_change_links (task_id, change_id)
      VALUES (${internalTaskId(input.taskId, idPrefix)}, ${internalChangeId(inserted.changeId, idPrefix)})
    `;
    const change = yield* readTaskChangeStartById(sql, inserted.changeId, idPrefix);
    if (change === undefined) {
      return yield* invalidData("create linked Change Start", "Change disappeared");
    }
    return { ok: true as const, change };
  });

const readExistingByTaskId = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly changeId: number }>`
      SELECT change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${internalTaskId(taskId, idPrefix)}
    `;
    const changeId = rows[0]?.changeId;
    return changeId === undefined
      ? undefined
      : yield* readTaskChangeStartById(sql, publicChangeId(idPrefix, changeId), idPrefix);
  });

const readTaskChangeStartById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(readChangeStartById(sql, changeId, idPrefix), (change) =>
    change === undefined
      ? Effect.succeed(undefined)
      : validateTaskChangeStart(sql, change, idPrefix),
  );

const validateTaskChangeStart = (
  sql: SqlClient.SqlClient,
  change: ChangeStartRecord,
  idPrefix: string,
) =>
  Effect.flatMap(readLinkByChangeId(sql, change.id, idPrefix), (link) =>
    (link === undefined) !== (change.acceptanceContext === null)
      ? invalidData("read Change Start", "Stored Change Task relationship is incomplete")
      : Effect.succeed(change),
  );

const readLinkByChangeId = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: number; readonly changeId: number }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE change_id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) => Effect.succeed(rows[0]),
  );

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
