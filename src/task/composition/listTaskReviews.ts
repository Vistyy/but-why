import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { listTaskReviewsSqlite } from "../adapters/sqlite/sqliteTaskReviewPersistence.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "../repoTaskIds.js";
import type { TaskReviewRecord } from "../review/taskReview.js";
import type { PublicTaskId } from "../taskId.js";

type TaskReviewsIdResolutionFailure = {
  readonly ok: false;
  readonly error: Exclude<RepoTaskIdResolution, { readonly ok: true }>;
};

export type ListTaskReviewsResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly reviews: readonly TaskReviewRecord[];
    }
  | TaskReviewsIdResolutionFailure;

export const listTaskReviews = (
  cwd: string,
  taskId: PublicTaskId,
): Effect.Effect<ListTaskReviewsResult, RepositoryOperationError> =>
  runRepositoryOperationAt<ListTaskReviewsResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const resolved = resolveRepoTaskId(context, taskId);
      if (!resolved.ok) return Effect.succeed({ ok: false as const, error: resolved });
      return Effect.map(
        repository.transaction("list Task Reviews", (sql) =>
          listTaskReviewsSqlite(
            sql,
            resolved.taskId,
            repository.idPrefix,
            repository.commonDirectory,
          ),
        ),
        (reviews) => ({ ok: true as const, taskId: resolved.taskId, reviews }),
      );
    },
  );
