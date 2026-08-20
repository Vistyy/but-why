import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { TaskState } from "../task/lifecycle.js";
import type { DependencyValidationCode, TaskDependencyFact, TaskSummary } from "../task/task.js";
import {
  internalTaskId,
  type PublicTaskId,
  publicTaskId,
  publicTaskIdFromInternal,
} from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type {
  CancelTaskInput,
  CancelTaskResult,
  CreateTaskInput,
  EditTaskDependenciesInput,
  ListTasksInput,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  StoredTaskRecord,
  UpdateTaskContextInput,
} from "../task/taskStore.js";
import {
  type DecodedStoredTaskRecordRow,
  type DecodedTaskSummaryRow,
  decodeStoredTaskRecordRow,
  decodeTaskContextRow,
  decodeTaskDependencyFacts,
  decodeTaskSummaryRow,
  type StoredTaskContextRow,
  type StoredTaskDependencyFactRow,
  type StoredTaskRecordRow,
  type StoredTaskSummaryRow,
} from "./sqliteTaskReadModel.js";

export const openSqliteTaskPersistence = (): Effect.Effect<TaskPersistence, never, RepositorySql> =>
  Effect.map(RepositorySql, (repository) => {
    const idPrefix = repository.idPrefix;
    return {
      createTask: (input) =>
        repository.transactionImmediate("create Task", (sql) => createTask(sql, idPrefix, input)),
      editTaskDependencies: (input) =>
        repository.transactionImmediate("edit Task dependencies", (sql) =>
          editTaskDependencies(sql, input, idPrefix),
        ),
      renameTask: (input) =>
        repository.transactionImmediate("rename Task", (sql) => renameTask(sql, input, idPrefix)),
      listTasks: (input) =>
        repository.transaction("list Tasks", (sql) => listTasks(sql, idPrefix, input)),
      listActionableTasks: () =>
        repository.transaction("list actionable Tasks", (sql) =>
          listActionableTasks(sql, idPrefix),
        ),
      getTaskById: (taskId) =>
        repository.transaction("read Task", (sql) => getTaskById(sql, taskId, idPrefix)),
      getTaskContextById: (taskId) =>
        repository.transaction("read Task Context", (sql) =>
          getTaskContextById(sql, taskId, idPrefix),
        ),
      updateTaskContext: (input) =>
        repository.transactionImmediate("update Task Context", (sql) =>
          updateTaskContext(sql, idPrefix, input),
        ),
      reviseTask: (input) =>
        repository.transactionImmediate("revise Task", (sql) => reviseTask(sql, input, idPrefix)),
      cancelTask: (input) =>
        repository.transactionImmediate("cancel Task", (sql) => cancelTask(sql, input, idPrefix)),
    };
  });

const createTask = (sql: SqlClient.SqlClient, idPrefix: string, input: CreateTaskInput) =>
  Effect.gen(function* () {
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO tasks (title, description, state)
      VALUES (${input.title}, ${input.description}, 'new')
      RETURNING id
    `;
    const allocatedId = inserted[0]?.id;
    if (allocatedId === undefined)
      return yield* invalidData("create Task", "Task identity was not allocated");
    const taskId = publicTaskIdFromInternal(allocatedId, idPrefix);
    const prerequisiteTaskIds = input.dependsOn ?? [];
    const dependencyError = yield* validateDependencies(
      sql,
      taskId,
      prerequisiteTaskIds,
      false,
      idPrefix,
    );
    if (dependencyError !== undefined) return dependencyError;
    yield* insertDependencies(sql, taskId, prerequisiteTaskIds, idPrefix);
    const created = yield* getTaskById(sql, taskId, idPrefix);
    if (created === undefined) return yield* invalidData("create Task", "Task disappeared");
    const context = yield* getTaskContextById(sql, taskId, idPrefix);
    if (context === undefined) return yield* invalidData("create Task", "Task Context disappeared");
    return { ok: true as const, task: created, context };
  });

export const editTaskDependencies = (
  sql: SqlClient.SqlClient,
  input: EditTaskDependenciesInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const target = yield* validateTaskDependencyEditTarget(sql, input.taskId, idPrefix);
    if (!target.ok) return target;

    if (input.operation === "replace" && input.prerequisiteTaskIds.length === 0) {
      return { ok: false as const, code: "replace_requires_dependency" as const };
    }

    const dependencyError =
      input.operation === "clear"
        ? undefined
        : yield* validateDependencies(sql, input.taskId, input.prerequisiteTaskIds, true, idPrefix);
    if (dependencyError !== undefined) return dependencyError;

    const currentIds: readonly PublicTaskId[] = yield* Effect.forEach(
      target.task.prerequisites,
      (dependency) =>
        Effect.try({
          try: () => publicTaskId(dependency.id),
          catch: (cause) =>
            new RepositoryPersistedDataInvalid({
              operationName: "edit Task dependencies",
              cause,
            }),
        }),
    );
    const requestedIds = input.prerequisiteTaskIds;
    const currentSet = new Set(currentIds);
    const requestedSet = new Set(requestedIds);
    const desiredIds =
      input.operation === "add"
        ? [...currentIds, ...requestedIds.filter((taskId) => !currentSet.has(taskId))]
        : input.operation === "remove"
          ? currentIds.filter((taskId) => !requestedSet.has(taskId))
          : input.operation === "replace"
            ? requestedIds
            : [];
    const added = desiredIds.filter((taskId) => !currentSet.has(taskId));
    const removed = currentIds.filter((taskId) => !desiredIds.includes(taskId));
    const unchanged =
      input.operation === "add"
        ? requestedIds.filter((taskId) => currentSet.has(taskId))
        : input.operation === "remove"
          ? requestedIds.filter((taskId) => !currentSet.has(taskId))
          : input.operation === "replace"
            ? desiredIds.filter((taskId) => currentSet.has(taskId))
            : [];

    if (input.operation === "add") {
      yield* insertDependencies(
        sql,
        input.taskId,
        requestedIds.filter((taskId) => !currentSet.has(taskId)),
        idPrefix,
      );
    } else if (input.operation === "remove") {
      yield* Effect.forEach(
        requestedIds,
        (prerequisiteTaskId) => sql`
          DELETE FROM task_dependencies
          WHERE dependent_task_id = ${internalTaskId(input.taskId, idPrefix)}
            AND prerequisite_task_id = ${internalTaskId(prerequisiteTaskId, idPrefix)}
        `,
        { discard: true },
      );
    } else {
      yield* sql`DELETE FROM task_dependencies WHERE dependent_task_id = ${internalTaskId(input.taskId, idPrefix)}`;
      yield* insertDependencies(sql, input.taskId, desiredIds, idPrefix);
    }

    const updated = yield* getTaskById(sql, input.taskId, idPrefix);
    if (updated === undefined) {
      return yield* invalidData("edit Task dependencies", "Task disappeared");
    }
    return {
      ok: true as const,
      operation: input.operation,
      task: updated,
      added,
      removed,
      unchanged,
    };
  });

const listTasks = (sql: SqlClient.SqlClient, idPrefix: string, input: ListTasksInput) =>
  Effect.gen(function* () {
    const limit = input.limit === "all" || input.limit === undefined ? -1 : input.limit;
    const rows = input.state
      ? yield* sql<StoredTaskSummaryRow>`
          SELECT id, id AS numericId, title, state
          FROM tasks
          WHERE state = ${input.state}
          ORDER BY id ASC
          LIMIT ${limit}
        `
      : input.includeDone
        ? yield* sql<StoredTaskSummaryRow>`
            SELECT id, id AS numericId, title, state
            FROM tasks
            ORDER BY id ASC
            LIMIT ${limit}
          `
        : yield* sql<StoredTaskSummaryRow>`
            SELECT id, id AS numericId, title, state
            FROM tasks
            WHERE state IN ('new', 'todo')
            ORDER BY id ASC
            LIMIT ${limit}
          `;
    const decoded = yield* decodePersisted("list Tasks", () =>
      rows.map((row) => decodeTaskSummaryRow(row, idPrefix)),
    );
    const tasks = yield* Effect.forEach(decoded, (row) =>
      rowToTaskSummary(sql, row, "list Tasks", idPrefix),
    );
    return { tasks, total: yield* countTasks(sql, input) };
  });

const countTasks = (sql: SqlClient.SqlClient, input: ListTasksInput) =>
  Effect.gen(function* () {
    const rows = input.state
      ? yield* sql<StoredCountRow>`
          SELECT COUNT(*) AS count
          FROM tasks WHERE state = ${input.state}
        `
      : input.includeDone
        ? yield* sql<StoredCountRow>`
            SELECT COUNT(*) AS count FROM tasks
          `
        : yield* sql<StoredCountRow>`
            SELECT COUNT(*) AS count
            FROM tasks WHERE state IN ('new', 'todo')
          `;
    return rows[0]?.count ?? 0;
  });

const listActionableTasks = (sql: SqlClient.SqlClient, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskSummaryRow>`
      SELECT id, id AS numericId, title, state
      FROM tasks
      WHERE state IN ('new', 'todo')
      ORDER BY
        CASE state WHEN 'new' THEN 0 WHEN 'todo' THEN 1 END ASC,
        id ASC
    `;
    const decoded = yield* decodePersisted("list actionable Tasks", () =>
      rows.map((row) => decodeTaskSummaryRow(row, idPrefix)),
    );
    return yield* Effect.forEach(decoded, (row) =>
      rowToTaskSummary(sql, row, "list actionable Tasks", idPrefix),
    );
  });

export const getTaskById = (sql: SqlClient.SqlClient, taskId: PublicTaskId, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskRecordRow>`
      SELECT id, id AS numericId, title, description, state,
        cancel_reason AS cancelReason
      FROM tasks
      WHERE id = ${internalTaskId(taskId, idPrefix)}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted("read Task", () =>
      decodeStoredTaskRecordRow(row, idPrefix),
    );
    return yield* rowToStoredTaskRecord(sql, decoded, "read Task", idPrefix);
  });

export const completeTask = (
  sql: SqlClient.SqlClient,
  taskId: string,
  _now: string,
  idPrefix: string,
) =>
  sql`
    UPDATE tasks SET state = 'done'
    WHERE id = ${internalTaskId(taskId, idPrefix)} AND state = 'todo'
  `;

export const cancelTaskState = (
  sql: SqlClient.SqlClient,
  taskId: string,
  reason: string,
  _now: string,
  idPrefix: string,
) =>
  sql`
    UPDATE tasks SET state = 'cancelled', cancel_reason = ${reason}
    WHERE id = ${internalTaskId(taskId, idPrefix)} AND state <> 'cancelled'
  `;

const getTaskContextById = (sql: SqlClient.SqlClient, taskId: PublicTaskId, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskContextRow>`
      SELECT id, title, description FROM tasks WHERE id = ${internalTaskId(taskId, idPrefix)}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted("read Task Context", () => decodeTaskContextRow(row, idPrefix));
  });

const updateTaskContext = (
  sql: SqlClient.SqlClient,
  idPrefix: string,
  input: UpdateTaskContextInput,
) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state !== "new") {
      return {
        ok: false as const,
        code:
          current.state === "todo"
            ? ("task_revision_required" as const)
            : ("invalid_task_state" as const),
        state: current.state,
      };
    }
    yield* sql`
      UPDATE tasks SET description = ${input.description}
      WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const updated = yield* getTaskById(sql, input.taskId, idPrefix);
    if (updated === undefined) {
      return yield* invalidData("update Task Context", "Task disappeared");
    }
    const context = yield* getTaskContextById(sql, input.taskId, idPrefix);
    if (context === undefined) {
      return yield* invalidData("update Task Context", "Task Context disappeared");
    }
    return { ok: true as const, task: updated, context };
  });

export const renameTask = (
  sql: SqlClient.SqlClient,
  input: RenameTaskInput,
  idPrefix: string,
): Effect.Effect<RenameTaskResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.title === input.title) return { ok: true as const, noOp: true, task: current };
    if (current.state !== "new") {
      return current.state === "todo"
        ? { ok: false as const, code: "task_revision_required" as const, state: current.state }
        : { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    yield* sql`
      UPDATE tasks SET title = ${input.title}
      WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const updated = yield* getTaskById(sql, input.taskId, idPrefix);
    if (updated === undefined) return yield* invalidData("rename Task", "Task disappeared");
    return { ok: true as const, noOp: false, task: updated };
  });

export const reviseTask = (sql: SqlClient.SqlClient, input: ReviseTaskInput, idPrefix: string) =>
  Effect.gen(function* () {
    const validated = yield* validateTaskRevisionTarget(sql, input.taskId, idPrefix);
    if (!validated.ok) return validated;
    const current = validated.task;
    if (current.state === "new") {
      const activeReview = yield* activeTaskReviewId(sql, input.taskId, idPrefix);
      if (activeReview !== undefined) {
        return {
          ok: false as const,
          code: "active_task_review" as const,
          reviewId: activeReview,
        };
      }
      return { ok: true as const, changed: false, task: current };
    }
    yield* sql`
      UPDATE tasks SET state = 'new'
      WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const revised = yield* getTaskById(sql, input.taskId, idPrefix);
    if (revised === undefined) return yield* invalidData("revise Task", "Task disappeared");
    return { ok: true as const, changed: true, task: revised };
  });

const cancelTask = (
  sql: SqlClient.SqlClient,
  input: CancelTaskInput,
  idPrefix: string,
): Effect.Effect<CancelTaskResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state === "done") return { ok: false as const, code: "task_already_done" as const };
    if (current.state === "cancelled") return { ok: true as const, changed: false, task: current };
    yield* sql`
      UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}
      WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const updated = yield* getTaskById(sql, input.taskId, idPrefix);
    if (updated === undefined) return yield* invalidData("cancel Task", "Task disappeared");
    return { ok: true as const, changed: true, task: updated };
  });

export const validateTaskRevisionTarget = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state !== "new" && current.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    return { ok: true as const, task: current };
  });

const taskDependenciesAreEditable = (state: TaskState): boolean => state === "new";

export const validateTaskDependencyEditTarget = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (!taskDependenciesAreEditable(current.state)) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    return { ok: true as const, task: current };
  });

const activeTaskReviewId = (sql: SqlClient.SqlClient, taskId: PublicTaskId, idPrefix: string) =>
  Effect.map(
    sql<{ readonly id: number }>`
      SELECT id FROM task_reviews
      WHERE task_id = ${internalTaskId(taskId, idPrefix)} AND outcome IS NULL
      LIMIT 1
    `,
    (rows) => rows[0]?.id,
  );

type DependencyValidationResult = {
  readonly ok: false;
  readonly code: DependencyValidationCode;
  readonly taskId?: PublicTaskId;
};

const validateDependencies = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
  dependentExists: boolean,
  idPrefix: string,
): Effect.Effect<
  DependencyValidationResult | undefined,
  SqlError | RepositoryPersistedDataInvalid
> =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    for (const prerequisiteTaskId of prerequisiteTaskIds) {
      const localError = validateDependencyIdentity(seen, dependentTaskId, prerequisiteTaskId);
      if (localError !== undefined) return localError;
      const storedError = yield* validateStoredDependency(
        sql,
        dependentTaskId,
        prerequisiteTaskId,
        dependentExists,
        idPrefix,
      );
      if (storedError !== undefined) return storedError;
    }
    return undefined;
  });

const validateDependencyIdentity = (
  seen: Set<string>,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskId: PublicTaskId,
): DependencyValidationResult | undefined => {
  if (seen.has(prerequisiteTaskId)) {
    return { ok: false, code: "dependency_duplicate", taskId: prerequisiteTaskId };
  }
  seen.add(prerequisiteTaskId);
  return prerequisiteTaskId === dependentTaskId
    ? { ok: false, code: "dependency_self", taskId: prerequisiteTaskId }
    : undefined;
};

const validateStoredDependency = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskId: PublicTaskId,
  dependentExists: boolean,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: number }>`
      SELECT id FROM tasks WHERE id = ${internalTaskId(prerequisiteTaskId, idPrefix)}
    `;
    if (rows[0] === undefined) {
      return {
        ok: false as const,
        code: "dependency_unknown_task" as const,
        taskId: prerequisiteTaskId,
      };
    }
    if (!dependentExists) return undefined;
    return (yield* dependencyPathExists(sql, prerequisiteTaskId, dependentTaskId, idPrefix))
      ? { ok: false as const, code: "dependency_cycle" as const }
      : undefined;
  });

const dependencyPathExists = (
  sql: SqlClient.SqlClient,
  fromTaskId: PublicTaskId,
  targetTaskId: PublicTaskId,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly taskId: number | null }>`
      WITH RECURSIVE prerequisites(task_id) AS (
        SELECT ${internalTaskId(fromTaskId, idPrefix)}
        UNION
        SELECT task_dependencies.prerequisite_task_id
        FROM task_dependencies
        JOIN prerequisites ON task_dependencies.dependent_task_id = prerequisites.task_id
      )
      SELECT tasks.id AS taskId
      FROM prerequisites
      LEFT JOIN tasks ON tasks.id = prerequisites.task_id
    `;
    const reachableTaskIds = yield* decodePersisted("validate Task dependencies", () =>
      rows.map((row) => {
        if (row.taskId === null) throw new Error("Task dependency references an unknown Task");
        return publicTaskIdFromInternal(row.taskId, idPrefix);
      }),
    );
    return reachableTaskIds.includes(targetTaskId);
  });

const insertDependencies = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
  idPrefix: string,
) =>
  Effect.forEach(
    prerequisiteTaskIds,
    (prerequisiteTaskId) => sql`
      INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
      VALUES (${internalTaskId(dependentTaskId, idPrefix)}, ${internalTaskId(prerequisiteTaskId, idPrefix)})
    `,
    { discard: true },
  );

const dependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  direction: "prerequisites" | "dependents",
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows =
      direction === "prerequisites"
        ? yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
            WHERE task_dependencies.dependent_task_id = ${internalTaskId(taskId, idPrefix)}
            ORDER BY tasks.id ASC
          `
        : yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
            WHERE task_dependencies.prerequisite_task_id = ${internalTaskId(taskId, idPrefix)}
            ORDER BY tasks.id ASC
          `;
    return yield* decodePersisted(operationName, () =>
      decodeTaskDependencyFacts(rows, taskId, idPrefix),
    );
  });

const rowToTaskSummary = (
  sql: SqlClient.SqlClient,
  row: DecodedTaskSummaryRow,
  operationName: string,
  idPrefix: string,
) =>
  Effect.map(
    dependencyFacts(sql, row.id, "prerequisites", operationName, idPrefix),
    (prerequisites) => taskSummary(row, prerequisites),
  );

const taskSummary = (
  row: DecodedTaskSummaryRow,
  prerequisites: readonly TaskDependencyFact[],
): TaskSummary => {
  const { numericId: _numericId, ...summary } = row;
  const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
  return { ...summary, startable: row.state === "todo" && blockedBy.length === 0, blockedBy };
};

const rowToStoredTaskRecord = (
  sql: SqlClient.SqlClient,
  row: DecodedStoredTaskRecordRow,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const prerequisites = yield* dependencyFacts(
      sql,
      row.id,
      "prerequisites",
      operationName,
      idPrefix,
    );
    const dependents = yield* dependencyFacts(sql, row.id, "dependents", operationName, idPrefix);
    return {
      ...taskSummary(row, prerequisites),
      description: row.description,
      cancelReason: row.cancelReason,
      prerequisites,
      dependents,
    } satisfies StoredTaskRecord;
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName,
      cause: new Error(message),
    }),
  );

type StoredCountRow = { readonly count: number };
