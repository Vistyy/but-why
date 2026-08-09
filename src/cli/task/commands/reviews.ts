// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { repoStateLoadError, repositoryStorageErrorResult, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { loadTaskReviewInspection } from "../../../task/loadTaskReviewInspection.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";
import type { TaskIdCommand } from "./submit.js";

export const runReviewsCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const loaded = loadTaskReviewInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.flatMap(tasks.getTaskById(taskId.taskId), (task) =>
      task === undefined
        ? Effect.succeed(taskNotFound(taskId.taskId))
        : loaded.inspection.listReviewsForTask(taskId.taskId).pipe(
            Effect.map((reviews) =>
              reviews.length === 0
                ? success({ taskId: taskId.taskId, reviews: [] })
                : success({
                    taskId: taskId.taskId,
                    reviews: reviews.map((review) => reviewSummary(review)),
                  }),
            ),
            Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
          ),
    );
  });
};

export const reviewSummary = (review: {
  readonly id: string;
  readonly outcome: string | null;
  readonly state: string;
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}) => ({
  id: review.id,
  state: review.state,
  ...(review.outcome === null ? {} : { outcome: review.outcome }),
  baseCommit: review.baseCommit,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});
