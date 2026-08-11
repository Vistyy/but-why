import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";

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
  _ownerTaskId: PublicTaskId,
): readonly TaskDependencyFact[] => {
  return rows.map((row) => ({
    id: decodeStoredTaskId(row.id, "related Task ID"),
    title: decodeStoredString(row.title, "related Task title"),
    state: decodeStoredTaskState(row.state),
  }));
};

export const decodePersisted = <A>(
  operationName: string,
  decode: () => A,
): Effect.Effect<A, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: decode,
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });

export const decodeStoredString = (value: unknown, _field: string): string => value as string;

export const decodeStoredNullableString = (value: unknown, _field: string): string | null =>
  value as string | null;

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
  _storageType: unknown,
  _field: string,
  _allowZero: boolean,
): number => Number(value);

export const decodeStoredTaskId = (value: unknown, field: string): PublicTaskId =>
  storedPublicTaskId(decodeStoredString(value, field));

export const decodeStoredTaskState = (value: unknown): TaskState => value as TaskState;
