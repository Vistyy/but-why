import { isTaskState, type TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { Effect } from "effect";

export type DecodedTaskSummaryRow = {
  readonly id: PublicTaskId;
  readonly numericId: number;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DecodedStoredTaskRecordRow = DecodedTaskSummaryRow & {
  readonly description: string;
  readonly cancelReason: string | null;
};

export type UnknownTaskSummaryRow = {
  readonly id: unknown;
  readonly numericId: unknown;
  readonly numericIdType: unknown;
  readonly title: unknown;
  readonly state: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

export type UnknownStoredTaskRecordRow = UnknownTaskSummaryRow & {
  readonly description: unknown;
  readonly cancelReason: unknown;
};

export type UnknownTaskContextRow = {
  readonly id: unknown;
  readonly title: unknown;
  readonly description: unknown;
};

export type UnknownTaskDependencyFactRow = {
  readonly id: unknown;
  readonly numericId: unknown;
  readonly numericIdType: unknown;
  readonly title: unknown;
  readonly state: unknown;
};

export const decodeTaskSummaryRow = (row: UnknownTaskSummaryRow): DecodedTaskSummaryRow => ({
  id: decodeStoredTaskId(row.id, "Task ID"),
  numericId: decodeStoredSqlitePositiveInteger(row.numericId, row.numericIdType, "Task numeric ID"),
  title: decodeStoredString(row.title, "Task title"),
  state: decodeStoredTaskState(row.state),
  createdAt: decodeStoredString(row.createdAt, "Task creation time"),
  updatedAt: decodeStoredString(row.updatedAt, "Task update time"),
});

export const decodeStoredTaskRecordRow = (
  row: UnknownStoredTaskRecordRow,
): DecodedStoredTaskRecordRow => ({
  ...decodeTaskSummaryRow(row),
  description: decodeStoredString(row.description, "Task description"),
  cancelReason: decodeStoredNullableString(row.cancelReason, "Task cancel reason"),
});

export const decodeTaskContextRow = (row: UnknownTaskContextRow) => ({
  id: decodeStoredTaskId(row.id, "Task ID"),
  title: decodeStoredString(row.title, "Task title"),
  description: decodeStoredString(row.description, "Task description"),
});

export const decodeTaskDependencyFacts = (
  rows: readonly UnknownTaskDependencyFactRow[],
  ownerTaskId: PublicTaskId,
): readonly TaskDependencyFact[] => {
  const ids = new Set<PublicTaskId>();
  return rows.map((row) => {
    const id = decodeStoredTaskId(row.id, "related Task ID");
    if (id === ownerTaskId) throw new Error("Task dependency relates a Task to itself");
    if (ids.has(id)) throw new Error("Duplicate Task dependency");
    ids.add(id);
    decodeStoredSqlitePositiveInteger(row.numericId, row.numericIdType, "related Task numeric ID");
    return {
      id,
      title: decodeStoredString(row.title, "related Task title"),
      state: decodeStoredTaskState(row.state),
    };
  });
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
): number => decodeStoredSqliteInteger(value, storageType, field, false);

export const decodeStoredSqliteNonnegativeInteger = (
  value: unknown,
  storageType: unknown,
  field: string,
): number => decodeStoredSqliteInteger(value, storageType, field, true);

const decodeStoredSqliteInteger = (
  value: unknown,
  storageType: unknown,
  field: string,
  allowZero: boolean,
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
  if (!Number.isSafeInteger(numeric) || (allowZero ? numeric < 0 : numeric <= 0)) {
    throw new Error(`${field} must be a ${allowZero ? "nonnegative" : "positive"} safe integer`);
  }
  return numeric;
};

export const decodeStoredTaskId = (value: unknown, field: string): PublicTaskId =>
  storedPublicTaskId(decodeStoredString(value, field));

export const decodeStoredTaskState = (value: unknown): TaskState => {
  const state = decodeStoredString(value, "Task state");
  if (!isTaskState(state)) throw new Error("Task state is unsupported");
  return state;
};
