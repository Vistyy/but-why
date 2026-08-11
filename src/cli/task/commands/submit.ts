import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withTaskReviews,
  withTasks,
} from "../taskCliSupport.js";
import type { TaskIdCommand } from "./approve.js";
import { taskReviewView } from "./taskReviewView.js";

export const runTaskSubmitCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (tasks) => {
    const resolved = resolveTaskId(tasks, parsed.taskId);
    if (!resolved.ok) return Effect.succeed(resolved.result);
    return withTaskReviews(environment, (reviews) =>
      Effect.map(reviews.submit(resolved.taskId, environment.now().toISOString()), (result) => {
        if (result.ok) {
          if (result.review.outcome === "passed") {
            return success({ review: taskReviewView(result.review) });
          }
          if (result.review.outcome === "blocked") {
            return runtimeError({
              code: "task_review_findings",
              message: "Task Review is blocked by Findings.",
              details: { review: taskReviewView(result.review) },
              help: [`Run \`by task review show ${result.review.id}\` to inspect every Finding.`],
            });
          }
          return runtimeError({
            code: "task_review_tooling_failed",
            message:
              "Task Review failed because its tooling did not produce a safe passing judgment.",
            details: { review: taskReviewView(result.review) },
            help: [`Run \`by task review show ${result.review.id}\` to inspect the failure.`],
          });
        }
        switch (result.code) {
          case "task_not_found":
            return taskNotFound(resolved.taskId);
          case "invalid_task_state":
            return runtimeError({
              code: result.code,
              message: `Task Review requires a New Task; current state is ${result.state}.`,
              details: { taskId: resolved.taskId, state: result.state },
              help: [`Run \`by task show ${resolved.taskId}\` to inspect its current lifecycle.`],
            });
          case "active_task_review":
            return runtimeError({
              code: result.code,
              message: "This Task already has an Active Task Review.",
              details: { taskId: resolved.taskId, reviewId: result.reviewId },
              help: [`Run \`by task review show ${result.reviewId}\` to inspect it.`],
            });
          case "review_base_unavailable":
            return runtimeError({
              code: result.code,
              message: result.message,
              help: [
                "Restore the canonical main checkout and its committed Repo Config, then retry.",
              ],
            });
          case "task_review_recovery_required":
            return runtimeError({
              code: result.code,
              message: "Task Review cleanup or final persistence did not complete.",
              details: { review: taskReviewView(result.review) },
              help: [`Run \`by task review show ${result.review.id}\` to inspect recovery state.`],
            });
        }
      }),
    );
  });
};
