import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import type { TaskReviewRepositorySubmitResult } from "../../../task/composition/loadTaskReviewUseCases.js";
import { type TaskCommandEnvironment, withTaskReviewSubmission } from "../taskCliSupport.js";
import { taskSimplificationAdviceAttemptView } from "./taskReviewView.js";
export type TaskSubmitCommand = {
  readonly taskId: string;
};

export const runTaskSubmitCommand = (
  command: TaskSubmitCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const now = environment.now().toISOString();
  return withTaskReviewSubmission(environment, parsed.taskId, now, (result) =>
    Effect.succeed(renderResult(result, parsed.taskId)),
  );
};

const simplificationAdviceView = (result: TaskReviewRepositorySubmitResult) => {
  if (result.ok && result.simplificationAdvice !== undefined) {
    return { simplificationAdvice: result.simplificationAdvice };
  }
  if (result.ok && result.simplificationAdviceAttempt != null) {
    return {
      simplificationAdvice: taskSimplificationAdviceAttemptView(result.simplificationAdviceAttempt),
    };
  }
  return {};
};

const renderResult = (result: TaskReviewRepositorySubmitResult, taskId: string): CliResult => {
  if (!result.ok && result.code === "remote_tasks_not_supported") {
    return taskIdResolutionError(result);
  }
  if (result.ok) {
    const review = result.review;
    const reviewCommand = `by task-review show ${review.id}`;
    switch (result.outcome) {
      case "passed":
        return success({
          review: { id: review.id, state: review.state, outcome: result.outcome },
          task: result.task,
          ...simplificationAdviceView(result),
          help: [
            `Run \`by task show ${review.taskId}\` to inspect its startability and next action.`,
          ],
        });
      case "blocked":
        return runtimeError({
          code: "task_review_findings",
          message: "Task Review is blocked by Findings; the Task remains New.",
          details: {
            review: {
              id: review.id,
              state: review.state,
              outcome: result.outcome,
              findings: review.findings,
            },
            task: result.task,
            ...simplificationAdviceView(result),
          },
          help: [`Run \`${reviewCommand}\` to inspect the Task Review.`],
        });
      case "tooling_failed":
        return runtimeError({
          code: "task_review_tooling_failed",
          message: "Task Review had a Tooling Failure; the Task remains New.",
          details: {
            review: {
              id: review.id,
              state: review.state,
              outcome: result.outcome,
              toolingFailure: review.toolingFailure,
            },
            task: result.task,
            ...simplificationAdviceView(result),
          },
          help: [`Run \`${reviewCommand}\` to inspect the Task Review.`],
        });
    }
  }
  switch (result.code) {
    case "task_not_found":
      return runtimeError({
        code: result.code,
        message: `Task was not found: ${taskId}`,
        details: { taskId },
        help: ["Run `by task list --all --limit all` to see known Tasks."],
      });
    case "invalid_task_state":
      return runtimeError({
        code: result.code,
        message: `Task Review requires a New Task; current state is ${result.state}.`,
        details: { taskId, state: result.state },
        help: [`Run \`by task show ${taskId}\` to inspect its current lifecycle.`],
      });
    case "task_change_linked":
      return runtimeError({
        code: result.code,
        message: "Task Review requires a Task that is not linked to a Change.",
        details: { taskId, changeId: result.changeId },
        help: [`Run \`by change show ${result.changeId}\` to inspect the linked Change.`],
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
        help: ["Restore the current worktree and its committed Repo Config, then retry."],
      });
    case "task_review_config_invalid":
      return runtimeError({
        code: result.code,
        message: result.message,
        help: ["Correct the Task Review configuration and retry."],
      });
    case "task_review_not_found":
      return runtimeError({
        code: result.code,
        message: "Task Review was not found while completing Task Submission.",
        details: { taskId },
        help: [
          `Run \`by task reviews ${taskId}\` to inspect Review history.`,
          `Run \`by task show ${taskId}\` to inspect the current Task state.`,
          `Retry \`by task submit ${taskId}\` only if the Task is still New and has no Active Review.`,
        ],
      });
    case "task_review_recovery_required":
      return runtimeError({
        code: result.code,
        message: "Task Review cleanup or final persistence did not complete.",
        details: {
          review: {
            id: result.review.id,
            state: result.review.state,
            outcome: result.review.outcome,
            reviewBase: {
              ref: result.review.baseRef,
              commit: result.review.baseCommit,
            },
            workspace: {
              path: result.review.workspacePath,
              cleanup: result.review.workspaceCleanup,
            },
            toolingFailure: result.review.toolingFailure,
          },
        },
        help: [`Run \`by task-review show ${result.review.id}\` to inspect recovery state.`],
      });
  }
};
