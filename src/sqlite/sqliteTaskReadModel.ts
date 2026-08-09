import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";

import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { isTaskState, type TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";

export type DecodedTaskRow = {
  readonly id: PublicTaskId;
  readonly numericId: number;
  readonly title: string;
  readonly description: string;
  readonly state: TaskState;
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DecodedTaskDependency = {
  readonly dependentTask: DecodedTaskRow;
  readonly prerequisiteTask: DecodedTaskRow;
};

export type DecodedTaskGraph = {
  readonly tasks: readonly DecodedTaskRow[];
  readonly tasksById: ReadonlyMap<PublicTaskId, DecodedTaskRow>;
  readonly dependencies: readonly DecodedTaskDependency[];
};

type UnknownTaskRow = {
  readonly id: unknown;
  readonly numericId: unknown;
  readonly numericIdType: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly state: unknown;
  readonly cancelReason: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

type UnknownTaskDependencyRow = {
  readonly dependentTaskId: unknown;
  readonly prerequisiteTaskId: unknown;
};

export const readDecodedTaskGraph = (
  sql: SqlClient.SqlClient,
  operationName: string,
): Effect.Effect<DecodedTaskGraph, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const taskRows = yield* sql<UnknownTaskRow>`
      SELECT id, CAST(numeric_id AS TEXT) AS numericId, typeof(numeric_id) AS numericIdType,
        title, description, state, cancel_reason AS cancelReason,
        created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
    `;
    const dependencyRows = yield* sql<UnknownTaskDependencyRow>`
      SELECT dependent_task_id AS dependentTaskId, prerequisite_task_id AS prerequisiteTaskId
      FROM task_dependencies
    `;

    return yield* decodePersisted(operationName, () => {
      const tasks = taskRows.map(decodeTaskRow);
      const tasksById = new Map<PublicTaskId, DecodedTaskRow>();
      const numericIds = new Set<number>();
      for (const task of tasks) {
        if (tasksById.has(task.id)) throw new Error("Duplicate stored Task ID");
        if (numericIds.has(task.numericId)) throw new Error("Duplicate stored Task numeric ID");
        tasksById.set(task.id, task);
        numericIds.add(task.numericId);
      }

      const dependencyKeys = new Set<string>();
      const dependencies = dependencyRows.map((row) => {
        const decoded = decodeTaskDependency(row);
        const dependentTask = tasksById.get(decoded.dependentTaskId);
        if (dependentTask === undefined) {
          throw new Error("Task dependency has an unknown dependent Task");
        }
        const prerequisiteTask = tasksById.get(decoded.prerequisiteTaskId);
        if (prerequisiteTask === undefined) {
          throw new Error("Task dependency has an unknown prerequisite Task");
        }
        if (dependentTask.id === prerequisiteTask.id) {
          throw new Error("Task dependency relates a Task to itself");
        }
        const key = `${dependentTask.id}\u0000${prerequisiteTask.id}`;
        if (dependencyKeys.has(key)) throw new Error("Duplicate Task dependency");
        dependencyKeys.add(key);
        return { dependentTask, prerequisiteTask };
      });

      return { tasks, tasksById, dependencies };
    });
  });

export const taskDependencyFacts = (
  graph: DecodedTaskGraph,
  taskId: PublicTaskId,
  direction: "prerequisites" | "dependents",
): readonly TaskDependencyFact[] => {
  const relatedTasks = graph.dependencies.flatMap((dependency) => {
    if (direction === "prerequisites" && dependency.dependentTask.id === taskId) {
      return [dependency.prerequisiteTask];
    }
    if (direction === "dependents" && dependency.prerequisiteTask.id === taskId) {
      return [dependency.dependentTask];
    }
    return [];
  });

  return relatedTasks
    .sort((left, right) => left.numericId - right.numericId)
    .map(({ id, title, state }) => ({ id, title, state }));
};

export const decodePersisted = <A>(
  operationName: string,
  decode: () => A,
): Effect.Effect<A, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: decode,
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });

export const decodeStoredString = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
};

export const decodeStoredNullableString = (value: unknown, field: string): string | null => {
  if (value === null) return null;
  return decodeStoredString(value, field);
};

export const decodeStoredSqlitePositiveInteger = (
  value: unknown,
  storageType: unknown,
  field: string,
): number => {
  if (storageType !== "integer" || typeof value !== "string") {
    throw new Error(`${field} must be a stored integer`);
  }
  let integer: bigint;
  try {
    integer = BigInt(value);
  } catch {
    throw new Error(`${field} must be a stored integer`);
  }
  const numeric = Number(integer);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return numeric;
};

export const decodeStoredTaskId = (value: unknown, field: string): PublicTaskId =>
  storedPublicTaskId(decodeStoredString(value, field));

const decodeTaskRow = (row: UnknownTaskRow): DecodedTaskRow => {
  const state = decodeStoredString(row.state, "Task state");
  if (!isTaskState(state)) throw new Error("Task state is unsupported");
  return {
    id: decodeStoredTaskId(row.id, "Task ID"),
    numericId: decodeStoredSqlitePositiveInteger(
      row.numericId,
      row.numericIdType,
      "Task numeric ID",
    ),
    title: decodeStoredString(row.title, "Task title"),
    description: decodeStoredString(row.description, "Task description"),
    state,
    cancelReason: decodeStoredNullableString(row.cancelReason, "Task cancel reason"),
    createdAt: decodeStoredString(row.createdAt, "Task creation time"),
    updatedAt: decodeStoredString(row.updatedAt, "Task update time"),
  };
};

const decodeTaskDependency = (row: UnknownTaskDependencyRow) => ({
  dependentTaskId: decodeStoredTaskId(row.dependentTaskId, "dependent Task ID"),
  prerequisiteTaskId: decodeStoredTaskId(row.prerequisiteTaskId, "prerequisite Task ID"),
});
