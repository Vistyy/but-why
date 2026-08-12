import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import type { TaskReviewSubmitResult } from "../../../task/review/taskReviewUseCases.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskNotFound,
  withReusableTaskReview,
  withTaskReviewSubmission,
  withTasks,
} from "../taskCliSupport.js";
import type { TaskIdCommand } from "./approve.js";

export const runTaskSubmitCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const now = environment.now().toISOString();
  return withReusableTaskReview(environment, parsed.taskId, now, (judgment) =>
    judgment === undefined
      ? withTasks(environment, (tasks) => {
          const resolved = resolveTaskId(tasks, parsed.taskId);
          if (!resolved.ok) return Effect.succeed(resolved.result);
          return withTaskReviewSubmission(environment, (reviews) =>
            Effect.map(reviews.submit(resolved.taskId, now), (result) =>
              renderResult(result, resolved.taskId),
            ),
          );
        })
      : Effect.succeed(renderResult(judgment, parsed.taskId)),
  );
};

const renderResult = (result: TaskReviewSubmitResult, taskId: string): CliResult => {
  if (result.ok) {
    const review = result.review;
    const reviewCommand = `by task-review show ${review.id}`;
    switch (result.outcome) {
      case "passed":
        return success({
          review: { id: review.id, outcome: result.outcome },
          task: result.task,
          help: [
            `Run \`by task show ${review.taskId}\` to inspect its startability and next action.`,
          ],
        });
      case "blocked":
        return runtimeError({
          code: "task_review_findings",
          message: "Task Review is blocked by Findings; the Task remains New.",
          details: {
            review: { id: review.id, outcome: result.outcome, findings: review.findings },
          },
          help: [`Run \`${reviewCommand}\` to inspect the Task Review.`],
        });
      case "tooling_failed":
        return runtimeError({
          code: "task_review_tooling_failed",
          message: "Task Review did not approve the Task.",
          details: {
            review: {
              id: review.id,
              outcome: result.outcome,
              toolingFailure: review.toolingFailure,
            },
          },
          help: [`Run \`${reviewCommand}\` to inspect the Task Review.`],
        });
    }
  }
  switch (result.code) {
    case "task_not_found":
      return taskNotFound(taskId);
    case "invalid_task_state":
      return runtimeError({
        code: result.code,
        message: `Task Review requires a New Task; current state is ${result.state}.`,
        details: { taskId, state: result.state },
        help: [`Run \`by task show ${taskId}\` to inspect its current lifecycle.`],
      });
    case "active_task_review":
      return runtimeError({
        code: result.code,
        message: "This Task already has an Active Task Review.",
        details: { taskId, reviewId: result.reviewId },
        help: [`Run \`by task-review show ${result.reviewId}\` to inspect it.`],
      });
    case "review_base_unavailable":
      return runtimeError({
        code: result.code,
        message: result.message,
        help: ["Restore the canonical main checkout and its committed Repo Config, then retry."],
      });
    case "task_review_config_invalid":
      return runtimeError({
        code: result.code,
        message: result.message,
        help: ["Correct the Task Review configuration and retry."],
      });
    case "task_review_recovery_required":
      return runtimeError({
        code: result.code,
        message: "Task Review cleanup or final persistence did not complete.",
        details: {
          review: {
            id: result.review.id,
            reviewBase: {
              ref: result.review.baseRef,
              commit: result.review.baseCommit,
            },
            workspace: {
              path: result.review.workspacePath,
              cleanup: result.review.workspaceCleanup,
            },
          },
        },
        help: [`Run \`by task-review show ${result.review.id}\` to inspect recovery state.`],
      });
  }
};
