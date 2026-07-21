import type { Effect } from "effect";

import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type {
  AppendTaskCommentInput,
  AppendTaskCommentResult,
  ApproveTaskInput,
  CreateTaskInput,
  ListTasksInput,
  ReplaceTaskDependenciesInput,
  ReplaceTaskDependenciesResult,
  StoredTaskRecord,
  TaskApprovalResult,
  TaskStateTransitionResult,
  TransitionTaskStateInput,
  UpdateTaskContextInput,
  UpdateTaskContextResult,
} from "./taskStore.js";
import type { DependencyValidationCode, TaskContext, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type CreateTaskPersistenceResult =
  | { readonly ok: true; readonly task: TaskSummary }
  | {
      readonly ok: false;
      readonly code: DependencyValidationCode;
      readonly taskId?: PublicTaskId;
    };

export type TaskPersistence = {
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<CreateTaskPersistenceResult, RepositoryStorageError>;
  readonly replaceTaskDependencies: (
    input: ReplaceTaskDependenciesInput,
  ) => Effect.Effect<ReplaceTaskDependenciesResult, RepositoryStorageError>;
  readonly listTasks: (
    input: ListTasksInput,
  ) => Effect.Effect<readonly TaskSummary[], RepositoryStorageError>;
  readonly listActionableTasks: () => Effect.Effect<readonly TaskSummary[], RepositoryStorageError>;
  readonly getTaskById: (
    taskId: PublicTaskId,
  ) => Effect.Effect<StoredTaskRecord | undefined, RepositoryStorageError>;
  readonly getTaskContextById: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskContext | undefined, RepositoryStorageError>;
  readonly approveTask: (
    input: ApproveTaskInput,
  ) => Effect.Effect<TaskApprovalResult, RepositoryStorageError>;
  readonly appendTaskComment: (
    input: AppendTaskCommentInput,
  ) => Effect.Effect<AppendTaskCommentResult, RepositoryStorageError>;
  readonly updateTaskContext: (
    input: UpdateTaskContextInput,
  ) => Effect.Effect<UpdateTaskContextResult, RepositoryStorageError>;
  readonly transitionTaskState: (
    input: TransitionTaskStateInput,
  ) => Effect.Effect<TaskStateTransitionResult, RepositoryStorageError>;
};
