import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { loadRepoLocalSubmissionContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { openSqliteTaskReviewPersistence } from "../sqlite/sqliteTaskReviewPersistence.js";
import { type AbandonTaskReviewResult, openAbandonTaskReview } from "./abandonTaskReview.js";
import type { PublicTaskId } from "./taskId.js";
import type { TaskReviewRecord } from "./taskReview.js";
import type {
  ActiveTaskReview,
  TaskReviewPersistence,
  TaskReviewTaskFact,
} from "./taskReviewStore.js";

export type TaskReviewInspection = {
  readonly getTaskFact: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewTaskFact | undefined, RepositoryStorageError>;
  readonly latestCompletedForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly activeForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<ActiveTaskReview | undefined, RepositoryStorageError>;
  readonly abandon: (input: {
    readonly reviewId: string;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<AbandonTaskReviewResult, RepositoryStorageError>;
};

export type LoadTaskReviewInspectionResult =
  | { readonly ok: true; readonly inspection: TaskReviewInspection }
  | {
      readonly ok: false;
      readonly error: import("../init/repoContext.js").LoadRepoLocalContextError;
    };

export const loadTaskReviewInspection = (input: {
  readonly cwd: string;
}): LoadTaskReviewInspectionResult => {
  const repoContext = loadRepoLocalSubmissionContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });
  const run = <A, E>(use: (persistence: TaskReviewPersistence) => Effect.Effect<A, E>) =>
    Effect.flatMap(openSqliteTaskReviewPersistence(), use).pipe(Effect.provide(repositoryLayer));

  return {
    ok: true,
    inspection: {
      getTaskFact: (taskId) => run((persistence) => persistence.getTaskFact(taskId)),
      latestCompletedForTask: (taskId) =>
        run((persistence) => persistence.latestCompletedReviewForTask(taskId)),
      activeForTask: (taskId) => run((persistence) => persistence.getActiveForTask(taskId)),
      abandon: (abandonInput) =>
        run((persistence) =>
          openAbandonTaskReview({
            persistence,
            executionLock: openSqliteExecutionLock({
              commonDirectory: context.commonDirectory,
            }),
            repoRoot: context.mainCheckoutRoot,
          }).abandon(abandonInput),
        ),
    },
  };
};
