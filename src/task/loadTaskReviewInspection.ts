import { existsSync } from "node:fs";

import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { loadRepoLocalContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { openSqliteTaskReviewPersistence } from "../sqlite/sqliteTaskReviewPersistence.js";
import { type AbandonTaskReviewResult, openAbandonTaskReview } from "./abandonTaskReview.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  TaskReviewFinding,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "./taskReview.js";
import type { ActiveTaskReview, TaskReviewPersistence } from "./taskReviewStore.js";

export type TaskReviewInspection = {
  readonly listReviewsForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<readonly TaskReviewRecord[], RepositoryStorageError>;
  readonly getReviewById: (
    reviewId: string,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly latestCompletedForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly activeForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<ActiveTaskReview | undefined, RepositoryStorageError>;
  readonly findings: (
    reviewId: string,
  ) => Effect.Effect<readonly TaskReviewFinding[], RepositoryStorageError>;
  readonly toolingFailures: (
    reviewId: string,
  ) => Effect.Effect<readonly TaskReviewToolingFailure[], RepositoryStorageError>;
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
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  if (!existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

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
      listReviewsForTask: (taskId) => run((persistence) => persistence.listReviewsForTask(taskId)),
      getReviewById: (reviewId) => run((persistence) => persistence.getReviewById(reviewId)),
      latestCompletedForTask: (taskId) =>
        run((persistence) => persistence.latestCompletedReviewForTask(taskId)),
      activeForTask: (taskId) => run((persistence) => persistence.getActiveForTask(taskId)),
      findings: (reviewId) => run((persistence) => persistence.listFindings(reviewId)),
      toolingFailures: (reviewId) =>
        run((persistence) => persistence.listToolingFailures(reviewId)),
      abandon: (abandonInput) =>
        run((persistence) =>
          openAbandonTaskReview({
            persistence,
            executionLock: openSqliteExecutionLock({
              commonDirectory: context.commonDirectory,
            }),
            repoRoot: context.mainCheckoutRoot,
            reviewerSessionsRoot: context.paths.operationalDir,
          }).abandon(abandonInput),
        ),
    },
  };
};
