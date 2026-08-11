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

export type StoredTaskSummaryRow = {
  readonly id: string;
  readonly numericId: number;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StoredTaskRecordRow = StoredTaskSummaryRow & {
  readonly description: string;
  readonly cancelReason: string | null;
};

export type StoredTaskContextRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
};

export type StoredTaskDependencyFactRow = {
  readonly id: string;
  readonly numericId: number;
  readonly title: string;
  readonly state: TaskState;
};

export const decodeTaskSummaryRow = (row: StoredTaskSummaryRow): DecodedTaskSummaryRow => ({
  ...row,
  id: storedPublicTaskId(row.id),
});

export const decodeStoredTaskRecordRow = (
  row: StoredTaskRecordRow,
): DecodedStoredTaskRecordRow => ({
  ...row,
  id: storedPublicTaskId(row.id),
});

export const decodeTaskContextRow = (row: StoredTaskContextRow) => ({
  ...row,
  id: storedPublicTaskId(row.id),
});

export const decodeTaskDependencyFacts = (
  rows: readonly StoredTaskDependencyFactRow[],
  ownerTaskId: PublicTaskId,
): readonly TaskDependencyFact[] =>
  rows.map((row) => {
    const id = storedPublicTaskId(row.id);
    if (id === ownerTaskId) throw new Error("Task dependency relates a Task to itself");
    return { id, title: row.title, state: row.state };
  });

export const decodePersisted = <A>(
  operationName: string,
  decode: () => A,
): Effect.Effect<A, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: decode,
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });
