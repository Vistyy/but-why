import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { type TaskCommandEnvironment, withTaskReviewReads } from "../taskCliSupport.js";
import { taskReviewView } from "./taskReviewView.js";

export type TaskReviewCommand =
  | { readonly action: "show"; readonly reviewId: string }
  | { readonly action: "abandon"; readonly reviewId: string; readonly reason: string };

export const runTaskReviewCommand = (
  command: TaskReviewCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> =>
  withTaskReviewReads(environment, (reviews) => {
    if (command.action === "show") {
      return Effect.gen(function* () {
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
      });
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
    return Effect.map(
      reviews.abandon(command.reviewId, command.reason, environment.now().toISOString()),
      (result) => {
        if (result.ok) return success({ review: taskReviewView(result.review) });
        if (result.code === "task_review_not_found") return reviewNotFound(command.reviewId);
        if (result.code === "task_review_not_active") {
          return runtimeError({
            code: result.code,
            message: "Task Review is not active.",
            details: { reviewId: command.reviewId },
            help: [`Run \`by task review show ${command.reviewId}\` to inspect its outcome.`],
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
    );
  });

const reviewNotFound = (reviewId: string): CliResult =>
  runtimeError({
    code: "task_review_not_found",
    message: `Task Review was not found: ${reviewId}`,
    details: { reviewId },
    help: ["Run `by task show <task-id>` to inspect the current Task Review identity."],
  });
