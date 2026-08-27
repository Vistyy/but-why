import { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { getTaskById, listTasksSqlite } from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import { readTaskReviewInspection } from "../../task/adapters/sqlite/sqliteTaskReviewPersistence.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "../../task/repoTaskIds.js";
import type { TaskReviewRecord } from "../../task/review/taskReview.js";
import type { TaskSimplificationAdvice } from "../../task/review/taskSimplificationAdvice.js";
import type { TaskRecord } from "../../task/task.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { ListTasksInput, ListTasksResult } from "../../task/taskStore.js";
import type { TaskChangeProjection } from "../inspectTaskChange.js";
import { listTaskChangeProjectionsSqlite } from "./taskChangeInspectionPersistence.js";

export type TaskListInspection = ListTasksResult & {
  readonly changeProjections: ReadonlyMap<string, TaskChangeProjection>;
};

export const listTasksForInspection = (
  cwd: string,
  input: ListTasksInput,
): Effect.Effect<TaskListInspection, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transaction("list Tasks", (sql) =>
      Effect.gen(function* () {
        const result = yield* listTasksSqlite(sql, repository.idPrefix, input);
        const changeProjections = yield* listTaskChangeProjectionsSqlite(
          sql,
          result.tasks.map((task) => task.id),
          repository.idPrefix,
        );
        return { ...result, changeProjections };
      }),
    ),
  );

export type TaskInspection = {
  readonly task: TaskRecord | undefined;
  readonly change: TaskChangeProjection | null;
  readonly review: TaskReviewRecord | undefined;
  readonly simplificationAdvice: TaskSimplificationAdvice | undefined;
  readonly proposalCurrent: boolean | undefined;
};

export type TaskInspectionResult =
  | { readonly ok: true; readonly value: TaskInspection }
  | { readonly ok: false; readonly error: Exclude<RepoTaskIdResolution, { readonly ok: true }> };

export const inspectTaskForInspection = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskInspectionResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (context, repository) => {
    const resolved = resolveRepoTaskId(context, taskId);
    if (!resolved.ok) {
      return Effect.succeed<TaskInspectionResult>({ ok: false, error: resolved });
    }
    return repository.transaction("read Task", (sql) =>
      Effect.gen(function* () {
        const task = yield* getTaskById(sql, resolved.taskId, repository.idPrefix);
        if (task === undefined) {
          return {
            ok: true as const,
            value: {
              task,
              change: null,
              review: undefined,
              simplificationAdvice: undefined,
              proposalCurrent: undefined,
            },
          };
        }
        const projections = yield* listTaskChangeProjectionsSqlite(
          sql,
          [resolved.taskId],
          repository.idPrefix,
        );
        const reviewInspection = yield* readTaskReviewInspection(
          sql,
          resolved.taskId,
          repository.idPrefix,
          repository.commonDirectory,
        );
        return {
          ok: true as const,
          value: {
            task,
            change: projections.get(resolved.taskId) ?? null,
            ...reviewInspection,
          },
        };
      }),
    );
  });
