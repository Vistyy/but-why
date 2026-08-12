import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import type { TaskReviewRepositorySubmitResult } from "../../../task/composition/loadTaskReviewUseCases.js";
import { type TaskCommandEnvironment, withTaskReviewSubmission } from "../taskCliSupport.js";
export type TaskSubmitCommand = {
  readonly taskId: string;
  readonly rerun?: boolean;
};

type TaskSubmissionMode = "ordinary" | "rerun";

export const runTaskSubmitCommand = (
  command: TaskSubmitCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const now = environment.now().toISOString();
  const mode = command.rerun === true ? "rerun" : "ordinary";
  return withTaskReviewSubmission(
    environment,
    parsed.taskId,
    now,
    { rerun: mode === "rerun" },
    (result) => Effect.succeed(renderResult(result, parsed.taskId, mode)),
  );
};

const renderResult = (
  result: TaskReviewRepositorySubmitResult,
  taskId: string,
  mode: TaskSubmissionMode,
): CliResult => {
  if (!result.ok && result.code === "remote_tasks_not_supported") {
    return taskIdResolutionError(result);
  }
  if (result.ok) {
    const review = result.review;
    const reviewCommand = `by task-review show ${review.id}`;
    switch (result.outcome) {
      case "passed":
        return success({
          submission: { mode },
          review: { id: review.id, state: review.state, outcome: result.outcome },
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
            submission: { mode },
            review: {
              id: review.id,
              state: review.state,
              outcome: result.outcome,
              findings: review.findings,
            },
            task: result.task,
          },
          help: [`Run \`${reviewCommand}\` to inspect the Task Review.`],
        });
      case "tooling_failed":
        return runtimeError({
          code: "task_review_tooling_failed",
          message:
            mode === "rerun"
              ? "Task Review had a Tooling Failure; the Task remains Todo and its previous applicable judgment is preserved."
              : "Task Review had a Tooling Failure; the Task remains New.",
          details: {
            submission: { mode },
            review: {
              id: review.id,
              state: review.state,
              outcome: result.outcome,
              toolingFailure: review.toolingFailure,
            },
            task: result.task,
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
        details: { submission: { mode }, taskId },
        help: ["Run `by task list --all --limit all` to see known Tasks."],
      });
    case "invalid_task_state":
      return runtimeError({
        code: result.code,
        message: `Task Review ${mode === "rerun" ? "rerun requires an unlinked Todo Task" : "requires a New Task"}; current state is ${result.state}.`,
        details: { submission: { mode }, taskId, state: result.state },
        help: [`Run \`by task show ${taskId}\` to inspect its current lifecycle.`],
      });
    case "task_change_linked":
      return runtimeError({
        code: result.code,
        message: "Task Review requires a Task that is not linked to a Change.",
        details: { submission: { mode }, taskId, changeId: result.changeId },
        help: [`Run \`by change show ${result.changeId}\` to inspect the linked Change.`],
      });
    case "active_task_review":
      return runtimeError({
        code: result.code,
        message: "This Task already has an Active Task Review.",
        details: { submission: { mode }, taskId, reviewId: result.reviewId },
        help: [`Run \`by task-review show ${result.reviewId}\` to inspect it.`],
      });
    case "review_base_unavailable":
      return runtimeError({
        code: result.code,
        message: result.message,
        details: { submission: { mode } },
        help: ["Restore the canonical main checkout and its committed Repo Config, then retry."],
      });
    case "task_review_config_invalid":
      return runtimeError({
        code: result.code,
        message: result.message,
        details: { submission: { mode } },
        help: ["Correct the Task Review configuration and retry."],
      });
    case "task_review_recovery_required":
      return runtimeError({
        code: result.code,
        message: "Task Review cleanup or final persistence did not complete.",
        details: {
          submission: { mode },
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
          },
        },
        help: [`Run \`by task-review show ${result.review.id}\` to inspect recovery state.`],
      });
  }
};
