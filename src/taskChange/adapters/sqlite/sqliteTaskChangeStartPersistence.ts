import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { recoverProvisionedChangeCreation } from "../../../change/changeStartPersistence.js";
import type { ChangeStartRecord } from "../../../change/changeStartStore.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import {
  changeIdSqlParameter,
  RepositorySql,
  taskIdSqlParameter,
} from "../../../sqlite/repositorySql.js";
import {
  createChange,
  insertLinkedChange,
  provisionCreatedChange,
  readChangeStartById,
  recordPrepareOutcome as recordChangePrepareOutcome,
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
    create: (input: TaskChangeStartCreateInput, provision, rollback) =>
      recoverProvisionedChangeCreation({
        create: (trackedProvision) =>
          repository.transactionImmediate("create Change Start", (sql) =>
            input.taskId === undefined
              ? createChange(sql, input, repository.idPrefix, trackedProvision)
              : createLinked(
                  sql,
                  { ...input, taskId: input.taskId },
                  repository.idPrefix,
                  trackedProvision,
                ),
          ),
        getById: (changeId) =>
          repository.transaction("reconcile Change Start creation", (sql) =>
            readTaskChangeStartById(sql, changeId),
          ),
        ...(provision === undefined ? {} : { provision }),
        ...(rollback === undefined ? {} : { rollback }),
      }),
    prepareTask: (taskId) =>
      repository.transaction("prepare Change Start linked to a Task", (sql) =>
        prepareTask(sql, taskId),
      ),
    createLinked: (input, provision, rollback) =>
      recoverProvisionedChangeCreation({
        create: (trackedProvision) =>
          repository.transactionImmediate("create linked Change Start", (sql) =>
            createLinked(sql, input, repository.idPrefix, trackedProvision),
          ),
        getById: (changeId) =>
          repository.transaction("reconcile linked Change Start creation", (sql) =>
            readTaskChangeStartById(sql, changeId),
          ),
        ...(provision === undefined ? {} : { provision }),
        ...(rollback === undefined ? {} : { rollback }),
      }),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) => readTaskChangeStartById(sql, changeId)),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        Effect.flatMap(recordChangePrepareOutcome(sql, changeId, failure, now), (change) =>
          validateTaskChangeStart(sql, change),
        ),
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
      SELECT tasks.id, tasks.id AS numericId, tasks.title, tasks.state
      FROM task_dependencies
      LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskIdSqlParameter(taskId)}
      ORDER BY tasks.id ASC
    `;
    const blockedBy = (yield* decodePersisted("prepare Change Start linked to a Task", () =>
      decodeTaskDependencyFacts(dependencyRows, storedPublicTaskId(taskId)),
    )).filter((dependency) => dependency.state !== "done");
    return blockedBy.length === 0
      ? { ok: true as const, existing: undefined, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const createLinked = (
  sql: SqlClient.SqlClient,
  input: TaskChangeStartCreationInput,
  idPrefix = "BY",
  provision?: Parameters<TaskChangeStartPersistence["createLinked"]>[1],
) =>
  Effect.gen(function* () {
    const prepared = yield* prepareTask(sql, input.taskId);
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
      VALUES (${taskIdSqlParameter(input.taskId)}, ${changeIdSqlParameter(inserted.changeId)})
    `;
    const change = yield* readTaskChangeStartById(sql, inserted.changeId);
    if (change === undefined) {
      return yield* invalidData("create linked Change Start", "Change disappeared");
    }
    return yield* provisionCreatedChange(sql, change, provision);
  });

const readExistingByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly changeId: string }>`
      SELECT change_id AS changeId
      FROM task_change_links
      WHERE task_id = ${taskIdSqlParameter(taskId)}
    `;
    const changeId = rows[0]?.changeId;
    return changeId === undefined ? undefined : yield* readTaskChangeStartById(sql, changeId);
  });

const readTaskChangeStartById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(readChangeStartById(sql, changeId), (change) =>
    change === undefined ? Effect.succeed(undefined) : validateTaskChangeStart(sql, change),
  );

const validateTaskChangeStart = (sql: SqlClient.SqlClient, change: ChangeStartRecord) =>
  Effect.flatMap(readLinkByChangeId(sql, change.id), (link) =>
    (link === undefined) !== (change.acceptanceContext === null)
      ? invalidData("read Change Start", "Stored Change Task relationship is incomplete")
      : Effect.succeed(change),
  );

const readLinkByChangeId = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<{ readonly taskId: string; readonly changeId: string }>`
      SELECT task_id AS taskId, change_id AS changeId
      FROM task_change_links
      WHERE change_id = ${changeIdSqlParameter(changeId)}
    `,
    (rows) => Effect.succeed(rows[0]),
  );

const readTaskContext = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskContextRow & { readonly state: unknown }>`
      SELECT id, title, description, state FROM tasks WHERE id = ${taskIdSqlParameter(taskId)}
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
