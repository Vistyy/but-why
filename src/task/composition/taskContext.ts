import { Effect } from "effect";
import { RepositoryStateUnavailable } from "../../contracts/repositoryStorageError.js";
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
import type { TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { UpdateTaskContextInput } from "../taskStore.js";

export type TaskContextDraft = { readonly path: string; readonly content: string };

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

export const getTaskContext = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskContext | undefined, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("read Task Context", (sql) =>
      getTaskContextByIdInSqlite(sql, taskId, repository.idPrefix),
    ),
  );

export const createTaskContextDraft = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskContextDraft | undefined, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (context, repository) =>
    Effect.flatMap(
      repository.transaction("read Task Context", (sql) =>
        getTaskContextByIdInSqlite(sql, taskId, repository.idPrefix),
      ),
      (taskContext) =>
        taskContext === undefined
          ? Effect.succeed(undefined)
          : Effect.try({
              try: () => ({
                ...writeTaskContextDraft(context.paths.taskContextDraftsPath, taskId, taskContext),
              }),
              catch: (cause) =>
                new RepositoryStateUnavailable({
                  statePath: context.paths.taskContextDraftsPath,
                  cause,
                }),
            }),
    ),
  );

export const applyTaskContextDraft = (
  cwd: string,
  input: ApplyTaskContextDraftInput,
): Effect.Effect<ApplyTaskContextDraftResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (context, repository) => {
    const draft = readTaskContextDraft(context.paths.taskContextDraftsPath, input.taskId);
    if (!draft.ok) return Effect.succeed({ ok: false, error: draft.error });
    return Effect.map(
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, repository.idPrefix, {
          taskId: input.taskId,
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
