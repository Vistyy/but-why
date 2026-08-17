import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { isTaskState, type TaskState } from "../task/lifecycle.js";
import type { TaskDependencyFact } from "../task/task.js";
import { type PublicTaskId, publicTaskIdFromInternal } from "../task/taskId.js";

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

export type StoredTaskSummaryRow = {
  readonly id: number;
  readonly numericId: number;
  readonly title: string;
  readonly state: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StoredTaskRecordRow = StoredTaskSummaryRow & {
  readonly description: string;
  readonly cancelReason: string | null;
};

export type StoredTaskContextRow = {
  readonly id: number;
  readonly title: string;
  readonly description: string;
};

export type StoredTaskDependencyFactRow = {
  readonly id: number;
  readonly numericId: number;
  readonly title: string;
  readonly state: unknown;
};

export const decodeTaskState = (value: unknown): TaskState => {
  if (typeof value !== "string" || !isTaskState(value)) {
    throw new Error("Stored Task state is invalid");
  }
  return value;
};

export const decodeTaskSummaryRow = (
  row: StoredTaskSummaryRow,
  idPrefix: string,
): DecodedTaskSummaryRow => ({
  ...row,
  id: publicTaskIdFromInternal(row.id, idPrefix),
  state: decodeTaskState(row.state),
});

export const decodeStoredTaskRecordRow = (
  row: StoredTaskRecordRow,
  idPrefix: string,
): DecodedStoredTaskRecordRow => ({
  ...row,
  id: publicTaskIdFromInternal(row.id, idPrefix),
  state: decodeTaskState(row.state),
});

export const decodeTaskContextRow = (row: StoredTaskContextRow, idPrefix: string) => ({
  ...row,
  id: publicTaskIdFromInternal(row.id, idPrefix),
});

export const decodeTaskDependencyFacts = (
  rows: readonly StoredTaskDependencyFactRow[],
  ownerTaskId: PublicTaskId,
  idPrefix: string,
): readonly TaskDependencyFact[] =>
  rows.map((row) => {
    const id = publicTaskIdFromInternal(row.id, idPrefix);
    if (id === ownerTaskId) throw new Error("Task dependency relates a Task to itself");
    return { id, title: row.title, state: decodeTaskState(row.state) };
  });

export const decodePersisted = <A>(
  operationName: string,
  decode: () => A,
): Effect.Effect<A, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: decode,
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });
