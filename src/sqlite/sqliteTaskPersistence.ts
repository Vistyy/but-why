import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import type { DependencyValidationCode, TaskContext, TaskSummary } from "../task/task.js";
import { generatedPublicTaskId, type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type {
  ApproveTaskInput,
  CancelTaskInput,
  CancelTaskResult,
  CreateTaskInput,
  EditTaskDependenciesInput,
  ListTasksInput,
  StoredTaskRecord,
  UpdateTaskContextInput,
} from "../task/taskStore.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeTaskLifecycleConsistency,
  decodeTaskState,
  requiredPositiveInteger,
  requiredString,
} from "./sqlitePersistenceDecoders.js";

export const openSqliteTaskPersistence = (
  taskPrefix: string,
): Effect.Effect<TaskPersistence, never, RepositorySql> =>
  Effect.map(RepositorySql, (repository) => ({
    createTask: (input) =>
      repository.transactionImmediate("create Task", (sql) => createTask(sql, taskPrefix, input)),
    editTaskDependencies: (input) =>
      repository.transactionImmediate("edit Task dependencies", (sql) =>
        editTaskDependencies(sql, input),
      ),
    listTasks: (input) => repository.operation("list Tasks", (sql) => listTasks(sql, input)),
    listActionableTasks: () => repository.operation("list actionable Tasks", listActionableTasks),
    getTaskById: (taskId) => repository.operation("read Task", (sql) => getTaskById(sql, taskId)),
    getTaskContextById: (taskId) =>
      repository.transaction("read Task Context", (sql) => getTaskContextById(sql, taskId)),
    approveTask: (input) =>
      repository.transactionImmediate("approve Task", (sql) => approveTask(sql, input)),
    updateTaskContext: (input) =>
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, input),
      ),
    cancelTask: (input) =>
      repository.transactionImmediate("cancel Task", (sql) => cancelTask(sql, input)),
  }));

const createTask = (sql: SqlClient.SqlClient, taskPrefix: string, input: CreateTaskInput) =>
  Effect.gen(function* () {
    const numericId = yield* nextTaskNumericId(sql);
    const taskId = generatedPublicTaskId(taskPrefix, numericId);
    const prerequisiteTaskIds = input.dependsOn ?? [];
    const dependencyError = yield* validateDependencies(sql, taskId, prerequisiteTaskIds, false);
    if (dependencyError !== undefined) return dependencyError;

    yield* sql`
      INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
      VALUES (${taskId}, ${numericId}, ${input.title}, ${input.description}, 'new', ${input.now}, ${input.now})
    `;
    yield* insertDependencies(sql, taskId, prerequisiteTaskIds);
    const created = yield* getTaskById(sql, taskId);
    if (created === undefined) return yield* invalidData("create Task", "Task disappeared");
    const context = yield* getTaskContextById(sql, taskId);
    if (context === undefined) return yield* invalidData("create Task", "Task Context disappeared");
    return { ok: true as const, task: created, context };
  });

const editTaskDependencies = (sql: SqlClient.SqlClient, input: EditTaskDependenciesInput) =>
  Effect.gen(function* () {
    const target = yield* taskDependencyEditTarget(sql, input.taskId);
    if (!target.ok) return target;

    if (input.operation === "replace" && input.prerequisiteTaskIds.length === 0) {
      return { ok: false as const, code: "replace_requires_dependency" as const };
    }

    const dependencyError =
      input.operation === "clear"
        ? undefined
        : yield* validateDependencies(sql, input.taskId, input.prerequisiteTaskIds, true);
    if (dependencyError !== undefined) return dependencyError;

    const currentIds = yield* Effect.forEach(target.task.prerequisites, (dependency) =>
      Effect.try({
        try: () => storedPublicTaskId(dependency.id),
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
      );
    } else if (input.operation === "remove") {
      yield* Effect.forEach(
        requestedIds,
        (prerequisiteTaskId) => sql`
          DELETE FROM task_dependencies
          WHERE dependent_task_id = ${input.taskId}
            AND prerequisite_task_id = ${prerequisiteTaskId}
        `,
        { discard: true },
      );
    } else {
      yield* sql`DELETE FROM task_dependencies WHERE dependent_task_id = ${input.taskId}`;
      yield* insertDependencies(sql, input.taskId, desiredIds);
    }

    const updated = yield* getTaskById(sql, input.taskId);
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

const listTasks = (sql: SqlClient.SqlClient, input: ListTasksInput) =>
  Effect.gen(function* () {
    const limit = input.limit === "all" || input.limit === undefined ? -1 : input.limit;
    const rows = yield* sql<TaskSummaryRow>`
      SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt,
        numeric_id AS numericId
      FROM tasks
    `;
    const orderedRows = yield* orderTaskRows(rows, input, "list Tasks");
    const selectedRows = limit === -1 ? orderedRows : orderedRows.slice(0, limit);
    const tasks = yield* Effect.forEach(selectedRows, (row) =>
      rowToTaskSummary(sql, row, "list Tasks"),
    );
    return {
      tasks,
      total: yield* countTasks(sql, input),
    };
  });

const countTasks = (sql: SqlClient.SqlClient, input: ListTasksInput) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly state: unknown }>`SELECT state FROM tasks`;
    return yield* Effect.try({
      try: () =>
        rows.filter((row) => {
          const state = decodeTaskState(row.state);
          return input.state === undefined
            ? input.includeDone || (state !== "done" && state !== "cancelled")
            : state === input.state;
        }).length,
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName: "list Tasks", cause }),
    });
  });

const orderTaskRows = (
  rows: readonly TaskSummaryRow[],
  input: ListTasksInput,
  operationName: string,
) =>
  Effect.map(
    Effect.try({
      try: () =>
        rows
          .map((row) => ({
            row,
            state: decodeTaskState(row.state),
            createdAt: requiredString(row.createdAt, "Task creation timestamp"),
            numericId: requiredPositiveInteger(row.numericId, "Task numeric ID"),
          }))
          .filter(({ state }) =>
            input.state === undefined
              ? input.includeDone || (state !== "done" && state !== "cancelled")
              : state === input.state,
          )
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.numericId - right.numericId,
          ),
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    }),
    (ordered) => ordered.map(({ row }) => row),
  );

const orderActionableTaskRows = (rows: readonly TaskSummaryRow[], operationName: string) =>
  Effect.map(
    Effect.try({
      try: () =>
        rows
          .map((row) => ({
            row,
            state: decodeTaskState(row.state),
            updatedAt: requiredString(row.updatedAt, "Task update timestamp"),
            numericId: requiredPositiveInteger(row.numericId, "Task numeric ID"),
          }))
          .filter(({ state }) => state === "new" || state === "todo")
          .sort(
            (left, right) =>
              (left.state === "new" ? 0 : 1) - (right.state === "new" ? 0 : 1) ||
              right.updatedAt.localeCompare(left.updatedAt) ||
              left.numericId - right.numericId,
          ),
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    }),
    (ordered) => ordered.map(({ row }) => row),
  );

const listActionableTasks = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskSummaryRow>`
      SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt,
        numeric_id AS numericId
      FROM tasks
    `;
    const orderedRows = yield* orderActionableTaskRows(rows, "list actionable Tasks");
    return yield* Effect.forEach(orderedRows, (row) =>
      rowToTaskSummary(sql, row, "list actionable Tasks"),
    );
  });

const getTaskById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskRecordRow>`
      SELECT id, title, description, state,
        cancel_reason AS cancelReason,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM tasks
      WHERE id = ${taskId}
    `;
    const row = rows[0];
    return row === undefined ? undefined : yield* rowToStoredTaskRecord(sql, row);
  });

const getTaskContextById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskContextHeaderRow>`
      SELECT id, title, description FROM tasks WHERE id = ${taskId}
    `;
    const task = rows[0];
    if (task === undefined) return undefined;
    const resolutions = yield* sql<{
      readonly content: unknown;
      readonly sequence: unknown;
    }>`
      SELECT resolution_content AS content, implementation_blockers.sequence
      FROM implementation_blockers
      JOIN changes ON changes.id = implementation_blockers.change_id
      WHERE changes.task_id = ${taskId} AND resolution_content IS NOT NULL
    `;
    const orderedResolutions = yield* decodeTaskValue(
      () =>
        resolutions
          .map((row) => ({
            content: requiredString(row.content, "Task Resolution content"),
            sequence: requiredPositiveInteger(row.sequence, "Implementation Blocker sequence"),
          }))
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ content }) => content),
      "read Task Context",
    );
    return yield* decodeTaskValue(
      () =>
        ({
          id: storedPublicTaskId(requiredString(task.id, "Task Context ID")),
          title: requiredString(task.title, "Task Context title"),
          description: requiredString(task.description, "Task Context description"),
          ...(orderedResolutions.length === 0 ? {} : { resolutions: orderedResolutions }),
        }) satisfies TaskContext,
      "read Task Context",
    );
  });

const approveTask = (sql: SqlClient.SqlClient, input: ApproveTaskInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state === "todo") return { ok: true as const, changed: false, task: current };
    if (current.state !== "new") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    yield* sql`UPDATE tasks SET state = 'todo', updated_at = ${input.now} WHERE id = ${input.taskId}`;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) return yield* invalidData("approve Task", "Task disappeared");
    return { ok: true as const, changed: true, task: updated };
  });

const updateTaskContext = (sql: SqlClient.SqlClient, input: UpdateTaskContextInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state !== "new" && current.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    yield* sql`
      UPDATE tasks SET title = ${input.title}, description = ${input.description},
        updated_at = ${input.now} WHERE id = ${input.taskId}
    `;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) {
      return yield* invalidData("update Task Context", "Task disappeared");
    }
    const context = yield* getTaskContextById(sql, input.taskId);
    if (context === undefined) {
      return yield* invalidData("update Task Context", "Task Context disappeared");
    }
    return { ok: true as const, task: updated, context };
  });

const cancelTask = (
  sql: SqlClient.SqlClient,
  input: CancelTaskInput,
): Effect.Effect<CancelTaskResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state === "done") return { ok: false as const, code: "task_already_done" as const };
    if (current.state === "cancelled") return { ok: true as const, changed: false, task: current };
    yield* sql`
      UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}, updated_at = ${input.now}
      WHERE id = ${input.taskId}
    `;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) return yield* invalidData("cancel Task", "Task disappeared");
    return { ok: true as const, changed: true, task: updated };
  });

const taskDependenciesAreEditable = (state: TaskState): boolean =>
  state === "new" || state === "todo";

const taskDependencyEditTarget = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (!taskDependenciesAreEditable(current.state)) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    const linked = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes WHERE task_id = ${taskId} LIMIT 1
    `;
    if (linked.length > 0) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    return { ok: true as const, task: current };
  });

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
) =>
  Effect.gen(function* () {
    if ((yield* getTaskById(sql, prerequisiteTaskId)) === undefined) {
      return {
        ok: false as const,
        code: "dependency_unknown_task" as const,
        taskId: prerequisiteTaskId,
      };
    }
    if (!dependentExists) return undefined;
    return (yield* dependencyPathExists(sql, prerequisiteTaskId, dependentTaskId))
      ? { ok: false as const, code: "dependency_cycle" as const }
      : undefined;
  });

const dependencyPathExists = (
  sql: SqlClient.SqlClient,
  fromTaskId: PublicTaskId,
  targetTaskId: PublicTaskId,
) =>
  Effect.map(
    sql<{ readonly found: number }>`
      WITH RECURSIVE prerequisites(task_id) AS (
        SELECT ${fromTaskId}
        UNION
        SELECT task_dependencies.prerequisite_task_id
        FROM task_dependencies
        JOIN prerequisites ON task_dependencies.dependent_task_id = prerequisites.task_id
      )
      SELECT 1 AS found FROM prerequisites WHERE task_id = ${targetTaskId} LIMIT 1
    `,
    (rows) => rows.length > 0,
  );

const insertDependencies = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
) =>
  Effect.forEach(
    prerequisiteTaskIds,
    (prerequisiteTaskId) => sql`
      INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
      VALUES (${dependentTaskId}, ${prerequisiteTaskId})
    `,
    { discard: true },
  );

const dependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: string,
  direction: "prerequisites" | "dependents",
) =>
  direction === "prerequisites"
    ? sql<TaskDependencyFactRow>`
        SELECT tasks.id, tasks.title, tasks.state, tasks.numeric_id AS numericId
        FROM task_dependencies
        JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
        WHERE task_dependencies.dependent_task_id = ${taskId}
      `
    : sql<TaskDependencyFactRow>`
        SELECT tasks.id, tasks.title, tasks.state, tasks.numeric_id AS numericId
        FROM task_dependencies
        JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
        WHERE task_dependencies.prerequisite_task_id = ${taskId}
      `;

const decodeDependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: string,
  direction: "prerequisites" | "dependents",
  operationName: string,
) =>
  Effect.flatMap(dependencyFacts(sql, taskId, direction), (rows) =>
    Effect.map(
      Effect.try({
        try: () =>
          rows
            .map((row) => ({
              fact: {
                id: storedPublicTaskId(requiredString(row.id, "Task dependency ID")),
                title: requiredString(row.title, "Task dependency title"),
                state: decodeTaskState(row.state),
              },
              numericId: requiredPositiveInteger(row.numericId, "Task numeric ID"),
            }))
            .sort((left, right) => left.numericId - right.numericId),
        catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
      }),
      (ordered) => ordered.map(({ fact }) => fact),
    ),
  );

const nextTaskNumericId = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<NumericIdRow>`SELECT numeric_id AS numericId FROM tasks`;
    const maximum = yield* decodeTaskValue(
      () =>
        rows.reduce(
          (current, row) =>
            Math.max(current, requiredPositiveInteger(row.numericId, "Task numeric ID")),
          0,
        ),
      "create Task",
    );
    const next = maximum + 1;
    if (!Number.isSafeInteger(next)) return yield* invalidData("create Task", "Invalid numeric ID");
    return next;
  });

const rowToTaskSummary = (
  sql: SqlClient.SqlClient,
  row: TaskSummaryRow,
  operationName = "read Task",
) =>
  Effect.gen(function* () {
    const id = yield* decodeTaskValue(
      () => storedPublicTaskId(requiredString(row.id, "Task ID")),
      operationName,
    );
    const state = yield* decodeTaskValue(() => decodeTaskState(row.state), operationName);
    const prerequisites = yield* decodeDependencyFacts(sql, id, "prerequisites", operationName);
    const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
    return {
      id,
      title: yield* decodeTaskValue(() => requiredString(row.title, "Task title"), operationName),
      state,
      createdAt: yield* decodeTaskValue(
        () => requiredString(row.createdAt, "Task creation timestamp"),
        operationName,
      ),
      updatedAt: yield* decodeTaskValue(
        () => requiredString(row.updatedAt, "Task update timestamp"),
        operationName,
      ),
      startable: state === "todo" && blockedBy.length === 0,
      blockedBy,
    } satisfies TaskSummary;
  });

const rowToStoredTaskRecord = (sql: SqlClient.SqlClient, row: StoredTaskRecordRow) =>
  Effect.gen(function* () {
    const summary = yield* rowToTaskSummary(sql, row, "read Task");
    const prerequisites = yield* decodeDependencyFacts(
      sql,
      summary.id,
      "prerequisites",
      "read Task",
    );
    const dependents = yield* decodeDependencyFacts(sql, summary.id, "dependents", "read Task");
    const cancelReason = yield* decodeTaskValue(
      () => decodeTaskLifecycleConsistency(summary.state, row.cancelReason),
      "read Task",
    );
    return {
      ...summary,
      description: yield* decodeTaskValue(
        () => requiredString(row.description, "Task description"),
        "read Task",
      ),
      cancelReason,
      prerequisites,
      dependents,
    } satisfies StoredTaskRecord;
  });

const decodeTaskValue = <A>(decode: () => A, operationName: string) =>
  Effect.try({
    try: decode,
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName,
      cause: new Error(message),
    }),
  );

type NumericIdRow = { readonly numericId: unknown };
type TaskSummaryRow = {
  readonly id: unknown;
  readonly title: unknown;
  readonly state: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly totalCount?: unknown;
  readonly numericId: unknown;
};
type TaskDependencyFactRow = {
  readonly id: unknown;
  readonly title: unknown;
  readonly state: unknown;
  readonly numericId: unknown;
};
type StoredTaskRecordRow = TaskSummaryRow & {
  readonly description: unknown;
  readonly cancelReason: unknown;
};
type TaskContextHeaderRow = {
  readonly id: unknown;
  readonly title: unknown;
  readonly description: unknown;
};
