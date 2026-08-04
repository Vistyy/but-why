import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type {
  AppendTaskCommentInput,
  AppendTaskCommentResult,
  ApproveTaskInput,
  CancelTaskInput,
  CancelTaskResult,
  CreateTaskInput,
  ListTasksInput,
  ListTasksResult,
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  StoredTaskRecord,
  TaskApprovalResult,
  TaskStateTransitionResult,
  TransitionTaskStateInput,
  UpdateTaskContextInput,
  UpdateTaskContextResult,
} from "./taskStore.js";
import type { DependencyValidationCode, TaskContext, TaskRecord, TaskSummary } from "./task.js";
import type { PublicTaskId } from "./taskId.js";

export type CreateTaskPersistenceResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | {
      readonly ok: false;
      readonly code: DependencyValidationCode;
      readonly taskId?: PublicTaskId;
    };

export type TaskPersistence = {
  readonly createTask: (
    input: CreateTaskInput,
  ) => Effect.Effect<CreateTaskPersistenceResult, RepositoryStorageError>;
  readonly editTaskDependencies: (
    input: EditTaskDependenciesInput,
  ) => Effect.Effect<EditTaskDependenciesResult, RepositoryStorageError>;
  readonly listTasks: (
    input: ListTasksInput,
  ) => Effect.Effect<ListTasksResult, RepositoryStorageError>;
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
  readonly cancelTask: (
    input: CancelTaskInput,
  ) => Effect.Effect<CancelTaskResult, RepositoryStorageError>;
};
