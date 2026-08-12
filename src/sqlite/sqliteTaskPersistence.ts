import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import type {
  DependencyValidationCode,
  TaskContext,
  TaskDependencyFact,
  TaskSummary,
} from "../task/task.js";
import { generatedPublicTaskId, type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type {
  CancelTaskInput,
  CancelTaskResult,
  CreateTaskInput,
  EditTaskDependenciesInput,
  ListTasksInput,
  ReviseTaskInput,
  StoredTaskRecord,
  UpdateTaskContextInput,
} from "../task/taskStore.js";
import { RepositorySql } from "./repositorySql.js";
import {
  type DecodedStoredTaskRecordRow,
  type DecodedTaskSummaryRow,
  decodePersisted,
  decodeStoredTaskRecordRow,
  decodeTaskContextRow,
  decodeTaskDependencyFacts,
  decodeTaskSummaryRow,
  type StoredTaskContextRow,
  type StoredTaskDependencyFactRow,
  type StoredTaskRecordRow,
  type StoredTaskSummaryRow,
} from "./sqliteTaskReadModel.js";

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
    listTasks: (input) => repository.transaction("list Tasks", (sql) => listTasks(sql, input)),
    listActionableTasks: () => repository.transaction("list actionable Tasks", listActionableTasks),
    getTaskById: (taskId) => repository.transaction("read Task", (sql) => getTaskById(sql, taskId)),
    getTaskContextById: (taskId) =>
      repository.transaction("read Task Context", (sql) => getTaskContextById(sql, taskId)),
    updateTaskContext: (input) =>
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, input),
      ),
    reviseTask: (input) =>
      repository.transactionImmediate("revise Task", (sql) => reviseTask(sql, input)),
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
    const rows = input.state
      ? yield* sql<StoredTaskSummaryRow>`
          SELECT id, numeric_id AS numericId, title, state,
            created_at AS createdAt, updated_at AS updatedAt
          FROM tasks
          WHERE state = ${input.state}
          ORDER BY created_at ASC, numeric_id ASC
          LIMIT ${limit}
        `
      : input.includeDone
        ? yield* sql<StoredTaskSummaryRow>`
            SELECT id, numeric_id AS numericId, title, state,
              created_at AS createdAt, updated_at AS updatedAt
            FROM tasks
            ORDER BY created_at ASC, numeric_id ASC
            LIMIT ${limit}
          `
        : yield* sql<StoredTaskSummaryRow>`
            SELECT id, numeric_id AS numericId, title, state,
              created_at AS createdAt, updated_at AS updatedAt
            FROM tasks
            WHERE state IN ('new', 'todo')
            ORDER BY created_at ASC, numeric_id ASC
            LIMIT ${limit}
          `;
    const decoded = yield* decodePersisted("list Tasks", () => rows.map(decodeTaskSummaryRow));
    const tasks = yield* Effect.forEach(decoded, (row) => rowToTaskSummary(sql, row, "list Tasks"));
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

const listActionableTasks = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskSummaryRow>`
      SELECT id, numeric_id AS numericId, title, state,
        created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE state IN ('new', 'todo')
      ORDER BY
        CASE state WHEN 'new' THEN 0 WHEN 'todo' THEN 1 END ASC,
        updated_at DESC,
        numeric_id ASC
    `;
    const decoded = yield* decodePersisted("list actionable Tasks", () =>
      rows.map(decodeTaskSummaryRow),
    );
    return yield* Effect.forEach(decoded, (row) =>
      rowToTaskSummary(sql, row, "list actionable Tasks"),
    );
  });

const getTaskById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskRecordRow>`
      SELECT id, numeric_id AS numericId, title, description, state,
        cancel_reason AS cancelReason, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted("read Task", () => decodeStoredTaskRecordRow(row));
    return yield* rowToStoredTaskRecord(sql, decoded, "read Task");
  });

const getTaskContextById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskContextRow>`
      SELECT id, title, description FROM tasks WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const task = yield* decodePersisted("read Task Context", () => decodeTaskContextRow(row));
    const resolutions = yield* readTaskResolutions(sql, taskId);
    return {
      ...task,
      ...(resolutions.length === 0 ? {} : { resolutions }),
    } satisfies TaskContext;
  });

const readTaskResolutions = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredResolutionRow>`
      SELECT implementation_blockers.sequence,
        implementation_blockers.id,
        implementation_blockers.resolved_at AS resolvedAt,
        implementation_blockers.resolution_id AS resolutionId,
        implementation_blockers.resolution_recorded_at AS resolutionRecordedAt,
        implementation_blockers.resolution_content AS resolutionContent
      FROM implementation_blockers
      JOIN changes ON changes.id = implementation_blockers.change_id
      WHERE changes.task_id = ${taskId}
        AND (
          implementation_blockers.resolved_at IS NOT NULL
          OR implementation_blockers.resolution_id IS NOT NULL
          OR implementation_blockers.resolution_recorded_at IS NOT NULL
          OR implementation_blockers.resolution_content IS NOT NULL
        )
      ORDER BY implementation_blockers.sequence ASC
    `;
    return rows.map((row) => row.resolutionContent);
  });

const updateTaskContext = (sql: SqlClient.SqlClient, input: UpdateTaskContextInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
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
      UPDATE tasks SET description = ${input.description}, updated_at = ${input.now}
      WHERE id = ${input.taskId}
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

const reviseTask = (sql: SqlClient.SqlClient, input: ReviseTaskInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state !== "new" && current.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    const linkedChanges = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes WHERE task_id = ${input.taskId} LIMIT 1
    `;
    const linkedChange = linkedChanges[0];
    if (linkedChange !== undefined) {
      return {
        ok: false as const,
        code: "task_change_linked" as const,
        changeId: linkedChange.id,
      };
    }
    if (current.state === "new") {
      const activeReview = yield* activeTaskReviewId(sql, input.taskId);
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
      UPDATE tasks SET state = 'new', updated_at = ${input.now}
      WHERE id = ${input.taskId}
    `;
    const revised = yield* getTaskById(sql, input.taskId);
    if (revised === undefined) return yield* invalidData("revise Task", "Task disappeared");
    return { ok: true as const, changed: true, task: revised };
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

const taskDependenciesAreEditable = (state: TaskState): boolean => state === "new";

const taskDependencyEditTarget = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (!taskDependenciesAreEditable(current.state)) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    const linked = yield* sql<{ readonly found: number }>`
      SELECT 1 AS found FROM changes WHERE task_id = ${taskId} LIMIT 1
    `;
    if (linked.length > 0) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    return { ok: true as const, task: current };
  });

const activeTaskReviewId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<{ readonly id: string }>`
      SELECT id FROM task_reviews
      WHERE task_id = ${taskId} AND state = 'running'
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
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM tasks WHERE id = ${prerequisiteTaskId}
    `;
    if (rows[0] === undefined) {
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
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly taskId: string | null }>`
      WITH RECURSIVE prerequisites(task_id) AS (
        SELECT ${fromTaskId}
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
        return storedPublicTaskId(row.taskId);
      }),
    );
    return reachableTaskIds.includes(targetTaskId);
  });

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
  taskId: PublicTaskId,
  direction: "prerequisites" | "dependents",
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows =
      direction === "prerequisites"
        ? yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
            WHERE task_dependencies.dependent_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `
        : yield* sql<StoredTaskDependencyFactRow>`
            SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
            WHERE task_dependencies.prerequisite_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `;
    return yield* decodePersisted(operationName, () => decodeTaskDependencyFacts(rows, taskId));
  });

const nextTaskNumericId = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredMaximumNumericIdRow>`
      SELECT MAX(numeric_id) AS maximumNumericId
      FROM tasks
    `;
    const next = (rows[0]?.maximumNumericId ?? 0) + 1;
    if (!Number.isSafeInteger(next)) {
      return yield* invalidData("create Task", "Next Task numeric ID must be safe");
    }
    return next;
  });

const rowToTaskSummary = (
  sql: SqlClient.SqlClient,
  row: DecodedTaskSummaryRow,
  operationName: string,
) =>
  Effect.map(dependencyFacts(sql, row.id, "prerequisites", operationName), (prerequisites) =>
    taskSummary(row, prerequisites),
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
) =>
  Effect.gen(function* () {
    const prerequisites = yield* dependencyFacts(sql, row.id, "prerequisites", operationName);
    const dependents = yield* dependencyFacts(sql, row.id, "dependents", operationName);
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

type StoredMaximumNumericIdRow = { readonly maximumNumericId: number | null };
type StoredCountRow = { readonly count: number };
type StoredResolutionRow = { readonly resolutionContent: string };
