// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeInspection } from "../../../change/loadChangeInspection.js";
import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { loadTaskReviewInspection } from "../../../task/loadTaskReviewInspection.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runTaskShowCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const reviewInspection =
    environment.taskUseCases === undefined
      ? loadTaskReviewInspection({ cwd: environment.cwd })
      : undefined;
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.gen(function* () {
      const task = yield* tasks.getTaskForInspection(taskId.taskId);
      if (task === undefined) return taskNotFound(taskId.taskId);
      const change =
        environment.taskUseCases === undefined
          ? loadChangeInspection({ cwd: environment.cwd })
          : undefined;
      if (change !== undefined && !change.ok) return stateStoreUnavailable(tasks.taskPrefix);
      const projection =
        change === undefined ? null : yield* change.inspection.inspectTaskProjection(taskId.taskId);
      const reviewSummary =
        reviewInspection === undefined || !reviewInspection.ok
          ? null
          : yield* Effect.all({
              latest: reviewInspection.inspection.latestCompletedForTask(taskId.taskId),
              active: reviewInspection.inspection.activeForTask(taskId.taskId),
            });
      const review =
        reviewSummary === null
          ? null
          : {
              ...(reviewSummary.latest === undefined
                ? {}
                : {
                    latest: {
                      id: reviewSummary.latest.id,
                      state: reviewSummary.latest.state,
                      outcome: reviewSummary.latest.outcome,
                      baseCommit: reviewSummary.latest.baseCommit,
                      createdAt: reviewSummary.latest.createdAt,
                    },
                  }),
              ...(reviewSummary.active === undefined
                ? {}
                : { active: { reviewId: reviewSummary.active.reviewId } }),
            };
      return success({
        task: {
          id: task.id,
          title: task.title,
          state: task.state,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          ...(task.cancelReason === null ? {} : { cancelReason: task.cancelReason }),
          prerequisites: task.prerequisites,
          dependents: task.dependents,
          change: projection,
        },
        ...(review === null || Object.keys(review).length === 0 ? {} : { taskReview: review }),
        ...(task.state === "new"
          ? { nextAction: `by task submit ${task.id}` }
          : task.state === "todo"
            ? { nextAction: `by change start --task ${task.id}` }
            : {}),
        contextCommand: `by task context ${task.id}`,
      });
    });
  });
};
