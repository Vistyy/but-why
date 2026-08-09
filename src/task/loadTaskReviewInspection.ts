import { existsSync } from "node:fs";

import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { loadRepoLocalSubmissionContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { openSqliteTaskReviewPersistence } from "../sqlite/sqliteTaskReviewPersistence.js";
import { type AbandonTaskReviewResult, openAbandonTaskReview } from "./abandonTaskReview.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  TaskReviewInspectionSnapshot,
  TaskReviewPersistence,
  TaskReviewTaskFact,
} from "./taskReviewStore.js";

export type TaskReviewInspection = {
  readonly getTaskFact: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewTaskFact | undefined, RepositoryStorageError>;
  readonly inspectForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewInspectionSnapshot, RepositoryStorageError>;
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
      readonly error:
        | import("../init/repoContext.js").LoadRepoLocalContextError
        | { readonly code: "state_store_unavailable" };
    };

export const loadTaskReviewInspection = (input: {
  readonly cwd: string;
}): LoadTaskReviewInspectionResult => {
  const repoContext = loadRepoLocalSubmissionContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  if (!existsSync(context.paths.statePath)) {
    return { ok: false, error: { code: "state_store_unavailable" } };
  }
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
      inspectForTask: (taskId) => run((persistence) => persistence.inspectForTask(taskId)),
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
