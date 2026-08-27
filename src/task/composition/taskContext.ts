import { Effect } from "effect";
import {
  RepositoryStateUnavailable,
  type RepositoryStorageError,
} from "../../contracts/repositoryStorageError.js";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import {
  getTaskContextById as getTaskContextByIdInSqlite,
  updateTaskContext,
} from "../adapters/sqlite/sqliteTaskPersistence.js";
import {
  readTaskContextDraft,
  removeTaskContextDraft,
  type TaskContextDraftReadError,
  writeTaskContextDraft,
} from "../files/contextDraft.js";
import type { TaskState } from "../lifecycle.js";
import { resolveRepoTaskId } from "../repoTaskIds.js";
import type { TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { UpdateTaskContextInput } from "../taskStore.js";

export type TaskContextDraft = { readonly path: string; readonly content: string };

type TaskContextIdResolutionFailure = {
  readonly ok: false;
  readonly error: Exclude<ReturnType<typeof resolveRepoTaskId>, { readonly ok: true }>;
};

type TaskContextResult = TaskContextIdResolutionFailure | TaskContext | undefined;

export const getTaskContext = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskContextResult, RepositoryOperationError> =>
  runRepositoryOperationAt<TaskContextResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const resolved = resolveRepoTaskId(context, taskId);
      if (!resolved.ok) {
        return Effect.succeed<TaskContextIdResolutionFailure>({ ok: false, error: resolved });
      }
      return repository.transaction("read Task Context", (sql) =>
        getTaskContextByIdInSqlite(sql, resolved.taskId, repository.idPrefix),
      );
    },
  );

export type ApplyTaskContextDraftInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type ApplyTaskContextDraftResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: "task_not_found" }
  | {
      readonly ok: false;
      readonly code: "task_revision_required" | "invalid_task_state";
      readonly state: TaskState;
    }
  | { readonly ok: false; readonly error: TaskContextDraftReadError }
  | {
      readonly ok: false;
      readonly code: "task_context_draft_cleanup_failed";
      readonly task: TaskRecord;
      readonly path: string;
    };

export const createTaskContextDraft = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<
  TaskContextDraft | undefined | TaskContextIdResolutionFailure,
  RepositoryOperationError
> =>
  runRepositoryOperationAt<
    TaskContextDraft | undefined | TaskContextIdResolutionFailure,
    RepositoryStorageError,
    never
  >(cwd, (context, repository) => {
    const resolved = resolveRepoTaskId(context, taskId);
    if (!resolved.ok) return Effect.succeed({ ok: false as const, error: resolved });
    return Effect.flatMap(
      repository.transaction("read Task Context", (sql) =>
        getTaskContextByIdInSqlite(sql, resolved.taskId, repository.idPrefix),
      ),
      (taskContext) =>
        taskContext === undefined
          ? Effect.succeed(undefined)
          : Effect.try({
              try: () => ({
                ...writeTaskContextDraft(
                  context.paths.taskContextDraftsPath,
                  resolved.taskId,
                  taskContext,
                ),
              }),
              catch: (cause) =>
                new RepositoryStateUnavailable({
                  statePath: context.paths.taskContextDraftsPath,
                  cause,
                }),
            }),
    );
  });

export const applyTaskContextDraft = (
  cwd: string,
  input: ApplyTaskContextDraftInput,
): Effect.Effect<
  ApplyTaskContextDraftResult | TaskContextIdResolutionFailure,
  RepositoryOperationError
> =>
  runRepositoryOperationAt<
    ApplyTaskContextDraftResult | TaskContextIdResolutionFailure,
    RepositoryStorageError,
    never
  >(cwd, (context, repository) => {
    const resolved = resolveRepoTaskId(context, input.taskId);
    if (!resolved.ok) return Effect.succeed({ ok: false as const, error: resolved });
    const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, resolved.taskId);
    if (!draft.ok) return Effect.succeed({ ok: false, error: draft.error });
    return Effect.map(
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, repository.idPrefix, {
          taskId: resolved.taskId,
          description: draft.draft.description,
          now: input.now,
        } satisfies UpdateTaskContextInput),
      ),
      (result): ApplyTaskContextDraftResult => {
        if (!result.ok) return result;
        if (!removeTaskContextDraft(draft.draft.path)) {
          return {
            ok: false,
            code: "task_context_draft_cleanup_failed",
            task: result.task,
            path: draft.draft.path,
          };
        }
        return result;
      },
    );
  });
