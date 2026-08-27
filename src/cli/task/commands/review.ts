import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  withTaskReviewInspection,
  withTaskReviewRecovery,
  withTasks,
} from "../taskCliSupport.js";
import { taskReviewHistoryView, taskReviewView } from "./taskReviewView.js";

export type TaskReviewCommand =
  | { readonly action: "show"; readonly reviewId: number }
  | { readonly action: "list"; readonly taskId: string }
  | { readonly action: "abandon"; readonly reviewId: number; readonly reason: string };

export const runTaskReviewCommand = (
  command: TaskReviewCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.action === "list") {
    const parsed = parseCliTaskIdValue(command.taskId);
    if (!parsed.ok) return Effect.succeed(parsed.result);
    return withTasks(environment, (cwd) => {
      const resolved = resolveTaskId(cwd, parsed.taskId);
      if (!resolved.ok) return Effect.succeed(resolved.result);
      return withTaskReviewInspection(environment, (reviews) =>
        Effect.map(reviews.listForTask(resolved.taskId), (history) =>
          success({
            taskId: resolved.taskId,
            reviews: history.map(taskReviewHistoryView),
            reviewCount: history.length,
            help:
              history.length === 0
                ? ["Run `by task submit <task-id>` to start a Task Review for a New Task."]
                : [`Run \`by task-review show <review-id>\` to inspect one Review.`],
          }),
        ),
      );
    });
  }
  if (command.action === "show") {
    return withTaskReviewInspection(environment, (reviews) =>
      Effect.gen(function* () {
        const review = yield* reviews.getById(command.reviewId);
        if (review === undefined) return reviewNotFound(command.reviewId);
        const proposalCurrent = yield* reviews.proposalIsCurrent(review);
        const identity = yield* reviews.inspectIdentity(review);
        return success({
          review: taskReviewView(review, proposalCurrent, identity),
          ...(review.state === "running"
            ? identity.verified
              ? {
                  help: [
                    `Stop the Task Review process, then run \`by task review abandon ${review.id} --reason "..."\` if it cannot finish.`,
                  ],
                }
              : {
                  help: [
                    "Resolve the reported Task Review identity problem before attempting abandonment.",
                  ],
                }
            : {}),
        });
      }),
    );
  }
  if (command.reason.trim().length === 0) {
    return Effect.succeed(
      usageError({
        code: "invalid_reason",
        message: "--reason must not be blank.",
        help: ["Pass a non-blank abandonment reason."],
      }),
    );
  }
  return withTaskReviewRecovery(environment, (reviews) =>
    Effect.map(
      reviews.abandon(command.reviewId, command.reason, environment.now().toISOString()),
      (result) => {
        if (result.ok) {
          return success({
            outcome: result.outcome,
            review: taskReviewView(result.review),
            task: result.task,
            help: [`Run \`by task show ${result.task.id}\` to inspect its next action.`],
          });
        }
        if (result.code === "task_review_not_found") return reviewNotFound(command.reviewId);
        if (result.code === "task_review_not_active") {
          return runtimeError({
            code: result.code,
            message: "Task Review is not active.",
            details: { reviewId: command.reviewId },
            help: [`Run \`by task-review show ${command.reviewId}\` to inspect its outcome.`],
          });
        }
        if ("message" in result) {
          return runtimeError({
            code: result.code,
            message: result.message,
            details: { review: taskReviewView(result.review) },
            help: [
              "Resolve the reported workspace identity or cleanup problem, then retry the exact abandonment command.",
            ],
          });
        }
        return reviewNotFound(command.reviewId);
      },
    ),
  );
};

const reviewNotFound = (reviewId: number): CliResult =>
  runtimeError({
    code: "task_review_not_found",
    message: `Task Review was not found: ${reviewId}`,
    details: { reviewId },
    help: ["Run `by task show <task-id>` to inspect the current Task Review identity."],
  });
