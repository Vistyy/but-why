import { Buffer } from "node:buffer";

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
  type DecodedTaskGraph,
  type DecodedTaskRow,
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredSqlitePositiveInteger,
  decodeStoredString,
  decodeStoredTaskId,
  readDecodedTaskGraph,
  taskDependencyFacts,
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
  Effect.map(readDecodedTaskGraph(sql, "list Tasks"), (graph) => {
    const matching = graph.tasks
      .filter((task) =>
        input.state
          ? task.state === input.state
          : input.includeDone || (task.state !== "done" && task.state !== "cancelled"),
      )
      .sort(
        (left, right) =>
          compareSqliteText(left.createdAt, right.createdAt) || left.numericId - right.numericId,
      );
    const selected =
      input.limit === undefined || input.limit === "all"
        ? matching
        : matching.slice(0, input.limit);
    return {
      tasks: selected.map((task) => rowToTaskSummary(graph, task)),
      total: matching.length,
    };
  });

const listActionableTasks = (sql: SqlClient.SqlClient) =>
  Effect.map(readDecodedTaskGraph(sql, "list actionable Tasks"), (graph) =>
    graph.tasks
      .filter((task) => task.state === "new" || task.state === "todo")
      .sort(
        (left, right) =>
          actionableStateOrder(left.state) - actionableStateOrder(right.state) ||
          compareSqliteText(right.updatedAt, left.updatedAt) ||
          left.numericId - right.numericId,
      )
      .map((task) => rowToTaskSummary(graph, task)),
  );

const actionableStateOrder = (state: TaskState): number => (state === "new" ? 0 : 1);

const compareSqliteText = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

const getTaskById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(readDecodedTaskGraph(sql, "read Task"), (graph) => {
    const task = graph.tasksById.get(taskId);
    return task === undefined ? undefined : rowToStoredTaskRecord(graph, task);
  });

const getTaskContextById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const graph = yield* readDecodedTaskGraph(sql, "read Task Context");
    const task = graph.tasksById.get(taskId);
    if (task === undefined) return undefined;
    const resolutions = yield* readTaskResolutions(sql, graph, taskId);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      ...(resolutions.length === 0 ? {} : { resolutions }),
    } satisfies TaskContext;
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
    if (current.state !== "new") {
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

const taskDependenciesAreEditable = (state: TaskState): boolean => state === "new";

const taskDependencyEditTarget = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const graph = yield* readDecodedTaskGraph(sql, "edit Task dependencies");
    const row = graph.tasksById.get(taskId);
    if (row === undefined) return { ok: false as const, code: "task_not_found" as const };
    const current = rowToStoredTaskRecord(graph, row);
    if (!taskDependenciesAreEditable(current.state)) {
      return { ok: false as const, code: "dependencies_locked" as const, state: current.state };
    }
    const links = yield* readChangeTaskLinks(sql, "edit Task dependencies", graph);
    if (links.some((link) => link.taskId === taskId)) {
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
    const graph = yield* readDecodedTaskGraph(sql, "validate Task dependencies");
    const seen = new Set<string>();
    for (const prerequisiteTaskId of prerequisiteTaskIds) {
      const localError = validateDependencyIdentity(seen, dependentTaskId, prerequisiteTaskId);
      if (localError !== undefined) return localError;
      const storedError = validateStoredDependency(
        graph,
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
  graph: DecodedTaskGraph,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskId: PublicTaskId,
  dependentExists: boolean,
): DependencyValidationResult | undefined => {
  if (!graph.tasksById.has(prerequisiteTaskId)) {
    return {
      ok: false as const,
      code: "dependency_unknown_task" as const,
      taskId: prerequisiteTaskId,
    };
  }
  if (!dependentExists) return undefined;
  return dependencyPathExists(graph, prerequisiteTaskId, dependentTaskId)
    ? { ok: false as const, code: "dependency_cycle" as const }
    : undefined;
};

const dependencyPathExists = (
  graph: DecodedTaskGraph,
  fromTaskId: PublicTaskId,
  targetTaskId: PublicTaskId,
): boolean => {
  const pending = [fromTaskId];
  const visited = new Set<PublicTaskId>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === targetTaskId) return true;
    visited.add(current);
    for (const dependency of graph.dependencies) {
      if (dependency.dependentTask.id === current) pending.push(dependency.prerequisiteTask.id);
    }
  }
  return false;
};

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

const nextTaskNumericId = (sql: SqlClient.SqlClient) =>
  Effect.flatMap(readDecodedTaskGraph(sql, "create Task"), (graph) => {
    const maximum = graph.tasks.reduce((current, task) => Math.max(current, task.numericId), 0);
    const next = maximum + 1;
    return Number.isSafeInteger(next)
      ? Effect.succeed(next)
      : invalidData("create Task", "Next Task numeric ID is unsafe");
  });

const rowToTaskSummary = (graph: DecodedTaskGraph, row: DecodedTaskRow): TaskSummary => {
  const prerequisites = taskDependencyFacts(graph, row.id, "prerequisites");
  const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startable: row.state === "todo" && blockedBy.length === 0,
    blockedBy,
  };
};

const rowToStoredTaskRecord = (graph: DecodedTaskGraph, row: DecodedTaskRow): StoredTaskRecord => ({
  ...rowToTaskSummary(graph, row),
  description: row.description,
  cancelReason: row.cancelReason,
  prerequisites: taskDependencyFacts(graph, row.id, "prerequisites"),
  dependents: taskDependencyFacts(graph, row.id, "dependents"),
});

const readChangeTaskLinks = (
  sql: SqlClient.SqlClient,
  operationName: string,
  graph?: DecodedTaskGraph,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<UnknownChangeTaskLinkRow>`
      SELECT id, task_id AS taskId FROM changes
    `;
    return yield* decodePersisted(operationName, () => {
      const ids = new Set<string>();
      const linkedTaskIds = new Set<PublicTaskId>();
      return rows.map((row): DecodedChangeTaskLink => {
        const id = decodeStoredString(row.id, "Change ID");
        if (ids.has(id)) throw new Error("Duplicate Change ID");
        ids.add(id);
        const taskId =
          row.taskId === null ? null : decodeStoredTaskId(row.taskId, "Change Task ID");
        if (taskId !== null) {
          if (linkedTaskIds.has(taskId)) throw new Error("Task is linked to multiple Changes");
          if (graph !== undefined && !graph.tasksById.has(taskId)) {
            throw new Error("Change has an unknown linked Task");
          }
          linkedTaskIds.add(taskId);
        }
        return { id, taskId };
      });
    });
  });

const readTaskResolutions = (
  sql: SqlClient.SqlClient,
  graph: DecodedTaskGraph,
  taskId: PublicTaskId,
) =>
  Effect.gen(function* () {
    const changes = yield* readChangeTaskLinks(sql, "read Task Context", graph);
    const changeIds = new Set(changes.map((change) => change.id));
    const linkedChangeIds = new Set(
      changes.filter((change) => change.taskId === taskId).map((change) => change.id),
    );
    const rows = yield* sql<UnknownResolutionRow>`
      SELECT CAST(sequence AS TEXT) AS sequence, typeof(sequence) AS sequenceType,
        id, change_id AS changeId, resolved_at AS resolvedAt,
        resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
        resolution_content AS resolutionContent
      FROM implementation_blockers
    `;
    return yield* decodePersisted("read Task Context", () => {
      const sequences = new Set<number>();
      const blockerIds = new Set<string>();
      return rows
        .map((row) => {
          const sequence = decodeStoredSqlitePositiveInteger(
            row.sequence,
            row.sequenceType,
            "Implementation Blocker sequence",
          );
          const blockerId = decodeStoredString(row.id, "Implementation Blocker ID");
          const changeId = decodeStoredString(row.changeId, "Implementation Blocker Change ID");
          if (sequences.has(sequence)) throw new Error("Duplicate Implementation Blocker sequence");
          if (blockerIds.has(blockerId)) throw new Error("Duplicate Implementation Blocker ID");
          if (!changeIds.has(changeId)) {
            throw new Error("Implementation Blocker has an unknown Change");
          }
          sequences.add(sequence);
          blockerIds.add(blockerId);
          const resolvedAt = decodeStoredNullableString(
            row.resolvedAt,
            "Implementation Blocker resolution time",
          );
          const resolutionId = decodeStoredNullableString(row.resolutionId, "Resolution ID");
          const resolutionRecordedAt = decodeStoredNullableString(
            row.resolutionRecordedAt,
            "Resolution recorded time",
          );
          const resolutionContent = decodeStoredNullableString(
            row.resolutionContent,
            "Resolution content",
          );
          const resolutionParts = [
            resolvedAt,
            resolutionId,
            resolutionRecordedAt,
            resolutionContent,
          ];
          const isUnresolved = resolutionParts.every((part) => part === null);
          const isResolved = resolutionParts.every((part) => part !== null);
          if (!isUnresolved && !isResolved) {
            throw new Error("Implementation Blocker resolution relationship is incomplete");
          }
          return { sequence, changeId, resolutionContent };
        })
        .flatMap((row) =>
          linkedChangeIds.has(row.changeId) && row.resolutionContent !== null
            ? [{ sequence: row.sequence, content: row.resolutionContent }]
            : [],
        )
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => row.content);
    });
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName,
      cause: new Error(message),
    }),
  );

type UnknownChangeTaskLinkRow = {
  readonly id: unknown;
  readonly taskId: unknown;
};

type DecodedChangeTaskLink = {
  readonly id: string;
  readonly taskId: PublicTaskId | null;
};

type UnknownResolutionRow = {
  readonly sequence: unknown;
  readonly sequenceType: unknown;
  readonly id: unknown;
  readonly changeId: unknown;
  readonly resolvedAt: unknown;
  readonly resolutionId: unknown;
  readonly resolutionRecordedAt: unknown;
  readonly resolutionContent: unknown;
};
