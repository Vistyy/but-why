import type { Effect } from "effect";

import type {
  ChangeCancellationCompletionFailure,
  ChangeCancellationMutationFailure,
  ChangeCancellationRecord,
} from "../change/changePorts.js";
import type { CancelChangeInput, CompleteMergedChangeInput } from "../change/changeStore.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { TaskRecord } from "../task/task.js";

export type TaskChangeLink = {
  readonly taskId: string;
  readonly changeId: string;
};

export type TaskChangeLinkPort = {
  readonly getByTaskId: (
    taskId: string,
  ) => Effect.Effect<TaskChangeLink | undefined, RepositoryStorageError>;
  readonly getByChangeId: (
    changeId: string,
  ) => Effect.Effect<TaskChangeLink | undefined, RepositoryStorageError>;
};

export type TaskChangeLinkMutationResult =
  | { readonly ok: true; readonly link: TaskChangeLink }
  | {
      readonly ok: false;
      readonly code: "task_not_found" | "change_not_found" | "task_change_conflict";
    };

export type TaskChangeLinkMutationPort = TaskChangeLinkPort & {
  readonly link: (
    input: TaskChangeLink,
  ) => Effect.Effect<TaskChangeLinkMutationResult, RepositoryStorageError>;
};

export type TaskChangeCancellationChange = ChangeCancellationRecord & {
  readonly taskId: string | null;
};

export type TaskChangeCancellationPort = {
  readonly getChangeById: (
    changeId: string,
  ) => Effect.Effect<TaskChangeCancellationChange | undefined, RepositoryStorageError>;
  readonly getChangeByTaskId: (
    taskId: string,
  ) => Effect.Effect<TaskChangeCancellationChange | undefined, RepositoryStorageError>;
  readonly completeMergedChange: (input: CompleteMergedChangeInput) => Effect.Effect<
    | {
        readonly ok: true;
        readonly changed: boolean;
        readonly change: TaskChangeCancellationChange;
        readonly task: TaskRecord | null;
      }
    | ChangeCancellationCompletionFailure
    | { readonly ok: false; readonly code: "task_completion_rejected" },
    RepositoryStorageError
  >;
  readonly cancelChange: (input: CancelChangeInput) => Effect.Effect<
    | {
        readonly ok: true;
        readonly changed: boolean;
        readonly change: TaskChangeCancellationChange;
        readonly task: TaskRecord | null;
      }
    | ChangeCancellationMutationFailure,
    RepositoryStorageError
  >;
};
