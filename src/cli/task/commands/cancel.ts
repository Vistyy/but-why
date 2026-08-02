// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import type { TaskCancellationResult } from "../../../change/cancelChange.js";
import { withCancellation } from "../../../change/loadChangeCancellation.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { TaskCommandEnvironment } from "../taskCliSupport.js";

export type TaskCancelCommand = {
  readonly taskId: string;
  readonly reason: string;
};

export const runCancelCommand = (
  command: TaskCancelCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.reason.trim().length === 0) {
    return Effect.succeed(
      usageError({
        code: "empty_reason",
        message: "Task cancellation requires a non-empty reason.",
        help: ["Provide a non-empty value for `--reason`."],
      }),
    );
  }

  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withCancellation(
    {
      cwd: environment.cwd,
      ...(environment.cancellationUseCases === undefined
        ? {}
        : { cancellationUseCases: environment.cancellationUseCases }),
    },
    (cancellation) => {
      const resolved = cancellation.resolveTaskId(parsed.taskId);
      if (!resolved.ok) return Effect.succeed(taskIdResolutionError(resolved));
      return Effect.map(
        cancellation.cancelTask({
          taskId: resolved.taskId,
          reason: command.reason,
          now: environment.now().toISOString(),
        }),
        (result) => cancelResult(resolved.taskId, result),
      );
    },
  );
};

const cancelResult = (taskId: PublicTaskId, result: TaskCancellationResult): CliResult => {
  if (result.ok) {
    return success({
      task: {
        id: result.task.id,
        state: result.task.state,
        changed: result.changed,
        status: result.status,
        reason: result.task.cancelReason,
        updatedAt: result.task.updatedAt,
      },
      ...(result.change === null
        ? {}
        : {
            change: {
              id: result.change.id,
              state: result.change.state,
              closeReason: result.change.closeReason,
              cleanup: result.cleanup,
            },
          }),
    });
  }
  if (result.code === "task_not_found") {
    return runtimeError({
      code: result.code,
      message: `Task was not found: ${taskId}`,
      details: { taskId },
      help: ["Run `by task list --all --limit all` to see known Tasks."],
    });
  }
  const messages: Record<Exclude<TaskCancellationResult, { readonly ok: true }>["code"], string> = {
    task_not_found: `Task was not found: ${taskId}`,
    change_not_found: `Change for Task ${taskId} was not found.`,
    task_already_done: `Cannot cancel completed Task ${taskId}.`,
    change_already_completed: `Task ${taskId} is already complete through its Change.`,
    github_pull_request_unavailable:
      "The owned pull request could not be read, so the Task remains unfinished.",
    owned_pull_request_mismatch:
      "The owned pull request does not match the recorded Change facts, so the Task remains unfinished.",
    github_close_failed:
      "The owned pull request could not be closed, so the Task remains unfinished.",
    submission_in_progress:
      "Another Submission or cancellation already owns this Change, so the Task remains unfinished.",
    active_validation_run: "A Validation Run remains active, so the Task remains unfinished.",
  };
  const help =
    result.code === "submission_in_progress"
      ? ["Wait for the other operation to finish, then retry Task Cancel."]
      : result.code === "active_validation_run"
        ? [
            `After stopping every process from the run, execute \`by validation-run abandon ${result.validationRunId} --reason <reason>\`.`,
          ]
        : result.code === "github_close_failed"
          ? ["Resolve the GitHub issue, then retry Task Cancel."]
          : result.code === "github_pull_request_unavailable"
            ? ["Restore GitHub access, then retry Task Cancel."]
            : result.code === "owned_pull_request_mismatch"
              ? ["Inspect the Change and resolve the remote mismatch before retrying."]
              : result.code === "change_already_completed"
                ? ["Inspect the Change with `by change show <change-id>`."]
                : result.code === "change_not_found"
                  ? ["Inspect the Task and its Change linkage before retrying."]
                  : ["Only unfinished Tasks can be cancelled."];
  return runtimeError({
    code: result.code,
    message: messages[result.code],
    details: {
      taskId,
      ...(result.validationRunId === undefined ? {} : { validationRunId: result.validationRunId }),
    },
    help,
  });
};
