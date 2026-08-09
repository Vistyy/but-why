// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { repoStateLoadError, repositoryStorageErrorResult, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { loadTaskReviewInspection } from "../../../task/loadTaskReviewInspection.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

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
    return Effect.gen(function* () {
      const task = yield* tasks.getTaskById(taskId.taskId);
      if (task === undefined) return taskNotFound(taskId.taskId);
      const reviews = yield* loaded.inspection.listReviewsForTask(taskId.taskId);
      const active = yield* loaded.inspection.activeForTask(taskId.taskId);
      const latest = reviews[reviews.length - 1];
      const nextAction = nextActionForHistory(task.state, active?.reviewId, latest, taskId.taskId);
      return success({
        taskId: taskId.taskId,
        reviews: reviews.map((review) => reviewSummary(review)),
        ...(nextAction === undefined ? {} : { nextAction }),
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))));
  });
};

// A valid next action depends on the current Task state, the current Active
// Review, and the latest Review outcome. Submit and retry actions are valid
// only while the Task is New; an Active Review owns submission until it ends.
const nextActionForHistory = (
  state: string,
  activeReviewId: string | undefined,
  latest: { readonly state: string; readonly outcome: string | null } | undefined,
  taskId: string,
): string | undefined => {
  if (state === "todo") return `by change start --task ${taskId}`;
  if (state !== "new") return undefined;
  if (activeReviewId !== undefined) {
    return `Active Task Review ${activeReviewId} is in progress. Abandon with \`by task-review abandon ${activeReviewId} --reason <reason>\` if its Submission process stopped.`;
  }
  if (latest?.state === "complete" && latest.outcome === "blocked") {
    return `Fix the Findings, then run \`by task submit ${taskId}\`.`;
  }
  if (latest?.state === "complete" && latest.outcome === "tooling_failed") {
    return `Tooling failed. Retry with \`by task submit ${taskId}\`.`;
  }
  return `by task submit ${taskId}`;
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
