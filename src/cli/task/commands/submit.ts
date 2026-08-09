// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  success,
} from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { loadTaskSubmission } from "../../../task/loadTaskSubmission.js";
import type { TaskSubmitResult } from "../../../task/submitTask.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runSubmitCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    const loaded = loadTaskSubmission({
      cwd: environment.cwd,
      globalConfigPath: environment.globalConfigPath,
      ...(environment.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: environment.reviewerAgentRuntime }),
    });
    if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
    return loaded.submission
      .submit({ taskId: taskId.taskId, now: environment.now().toISOString() })
      .pipe(
        Effect.map((result) => submitResult(result, taskId.taskId)),
        Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
      );
  });
};

const submitResult = (result: TaskSubmitResult, taskId: string): CliResult => {
  if (!result.ok) {
    switch (result.code) {
      case "task_not_found":
        return taskNotFound(taskId);
      case "invalid_task_state":
        return runtimeError({
          code: "invalid_task_state",
          message: `Cannot submit task ${taskId} from state ${result.state}.`,
          details: { taskId, state: result.state },
          help: [
            result.state === "todo"
              ? "Task is already approved. Run `by task show <task-id>` for its approval evidence."
              : `Inspect Task ${taskId} with \`by task show ${taskId}\`.`,
          ],
        });
      case "task_linked_to_change":
        return runtimeError({
          code: "task_linked_to_change",
          message: `Task ${taskId} is linked to a Change and cannot be submitted for review.`,
          details: { taskId },
          help: ["Run `by task show <task-id>` to inspect the linked Change."],
        });
      case "review_active":
        return runtimeError({
          code: "review_active",
          message: `A Task Review is already active for task ${taskId}.`,
          details: { taskId, reviewId: result.reviewId },
          help: [
            `Inspect it with \`by task-review show ${result.reviewId}\`.`,
            `Abandon it with \`by task-review abandon ${result.reviewId} --reason <reason>\` if its Submission process stopped.`,
          ],
        });
      case "review_cleanup_pending":
        return runtimeError({
          code: "review_cleanup_pending",
          message: `Task Review ${result.reviewId} could not finish cleanup, so the Task remains New.`,
          details: {
            reviewId: result.reviewId,
            operation: result.completionFailure.operationName,
            error: result.completionFailure.errorMessage,
          },
          help: [
            `Retry cleanup with \`by task-review abandon ${result.reviewId} --reason <reason>\`.`,
          ],
        });
      case "main_checkout_unavailable":
        return runtimeError({
          code: "main_checkout_unavailable",
          message: "The Local Repository's canonical main checkout is unavailable.",
          help: ["Restore the canonical main checkout, then retry Task Submission."],
        });
      case "validation_policy_invalid":
        return runtimeError({
          code: "validation_policy_invalid",
          message: result.message,
          help: ["Fix the Task Reviewer policy, then retry Task Submission."],
        });
      case "submission_in_progress":
        return runtimeError({
          code: "submission_in_progress",
          message: `Another Task Submission, mutation, or abandonment already owns task ${taskId}.`,
          details: { taskId },
          help: ["Wait for the other operation to finish, then retry Task Submission."],
        });
    }
  }
  if (result.status === "reused") {
    return success({
      review: {
        id: result.reviewId,
        outcome: result.outcome,
        reused: true,
        task: { id: result.task.id, state: result.task.state },
      },
    });
  }
  if (result.status === "tooling_failed") {
    return success({
      review: {
        id: result.reviewId,
        outcome: "tooling_failed",
        task: { id: result.task.id, state: result.task.state },
        toolingFailures: result.toolingFailures,
      },
      nextAction: `by task submit ${result.task.id}`,
    });
  }
  return success({
    review: {
      id: result.reviewId,
      outcome: result.status,
      baseCommit: result.baseCommit,
      task: { id: result.task.id, state: result.task.state },
      ...(result.findings === undefined || result.findings.length === 0
        ? {}
        : { findings: result.findings }),
    },
    ...(result.status === "blocked"
      ? {
          nextAction: `Inspect Findings with \`by task-review show ${result.reviewId}\`.`,
        }
      : {}),
  });
};
