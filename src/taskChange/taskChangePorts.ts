import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";

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
