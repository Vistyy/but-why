// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  success,
} from "../../../cliResults.js";
import type { TaskState } from "../../../task/lifecycle.js";
import { loadTaskReviewInspection } from "../../../task/loadTaskReviewInspection.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { TaskReviewOutcome } from "../../../task/taskReview.js";
import type { TaskCommandEnvironment } from "../../task/taskCliSupport.js";

const reviewNotFound = (reviewId: string): CliResult =>
  runtimeError({
    code: "review_not_found",
    message: `Task Review was not found: ${reviewId}`,
    details: { reviewId },
    help: ["Inspect the Task with `by task show <task-id>`."],
  });

export const runAbandonCommand = (
  command: { readonly reviewId: string; readonly reason: string },
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.reason.trim().length === 0)
    return Effect.succeed({
      exitCode: 2,
      stdout: {
        error: {
          code: "empty_reason",
          message: "Task Review abandonment requires a non-empty reason.",
          help: ["Provide a non-empty value for `--reason`."],
        },
      },
    });
  const loaded = loadTaskReviewInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return loaded.inspection
    .abandon({
      reviewId: command.reviewId,
      reason: command.reason,
      now: environment.now().toISOString(),
    })
    .pipe(
      Effect.map((result) =>
        result.ok
          ? success({
              ...result,
              nextAction: taskReviewNextAction(result.task, result.outcome),
            })
          : result.status === "not_found"
            ? reviewNotFound(command.reviewId)
            : runtimeError({
                code:
                  result.status === "submission_in_progress"
                    ? "submission_in_progress"
                    : "task_review_cleanup_failed",
                message:
                  result.status === "submission_in_progress"
                    ? "Another Task Submission or abandonment already owns this Task."
                    : "Task Review resources could not be cleaned up, so abandonment is incomplete.",
                details: result,
                help:
                  result.status === "submission_in_progress"
                    ? ["Wait for the other operation to finish, then retry Task Review Abandon."]
                    : [
                        `Stop every process, repair the reported resources, then retry \`by task-review abandon ${command.reviewId} --reason <reason>\`.`,
                      ],
              }),
      ),
      Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    );
};

const taskReviewNextAction = (
  task: { readonly id: PublicTaskId; readonly state: TaskState },
  outcome: TaskReviewOutcome,
): string => {
  if (task.state === "new") {
    if (outcome === "passed") return `by task approve ${task.id}`;
    if (outcome === "blocked") return `by task context draft ${task.id}`;
    return `by task submit ${task.id}`;
  }
  return `by task show ${task.id}`;
};
