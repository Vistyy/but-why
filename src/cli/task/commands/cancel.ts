// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { TaskCancellationResult } from "../../../taskChange/cancelTaskChange.js";
import { withCancellation } from "../../change/cancellationSupport.js";
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

type TaskCancellationFailure = Exclude<TaskCancellationResult, { readonly ok: true }>;

type TaskCancelErrorPresentation = {
  readonly message: string;
  readonly help: readonly string[];
};

const taskCancelErrorPresentation: Record<
  TaskCancellationFailure["code"],
  (taskId: PublicTaskId, result: TaskCancellationFailure) => TaskCancelErrorPresentation
> = {
  task_not_found: (taskId) => ({
    message: `Task was not found: ${taskId}`,
    help: ["Run `by task list --all --limit all` to see known Tasks."],
  }),
  change_not_found: (taskId) => ({
    message: `Change for Task ${taskId} was not found.`,
    help: ["Inspect the Task and its Change linkage before retrying."],
  }),
  task_already_done: (taskId) => ({
    message: `Cannot cancel completed Task ${taskId}.`,
    help: ["Only unfinished Tasks can be cancelled."],
  }),
  change_already_completed: (taskId) => ({
    message: `Task ${taskId} is already complete through its Change.`,
    help: ["Inspect the Change with `by change show <change-id>`."],
  }),
  github_pull_request_unavailable: () => ({
    message: "The owned pull request could not be read, so the Task remains unfinished.",
    help: ["Restore GitHub access, then retry Task Cancel."],
  }),
  owned_pull_request_mismatch: () => ({
    message:
      "The owned pull request does not match the recorded Change facts, so the Task remains unfinished.",
    help: ["Inspect the Change and resolve the remote mismatch before retrying."],
  }),
  github_close_failed: () => ({
    message: "The owned pull request could not be closed, so the Task remains unfinished.",
    help: ["Resolve the GitHub issue, then retry Task Cancel."],
  }),
  submission_in_progress: () => ({
    message:
      "Another Submission or cancellation already owns this Change, so the Task remains unfinished.",
    help: ["Wait for the other operation to finish, then retry Task Cancel."],
  }),
  active_validation_run: (_taskId, result) => ({
    message: "A Validation Run remains active, so the Task remains unfinished.",
    help: [
      `After stopping every process from the run, execute \`by validation-run abandon ${result.validationRunId} --reason <reason>\`.`,
    ],
  }),
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
  const presentation = taskCancelErrorPresentation[result.code](taskId, result);
  return runtimeError({
    code: result.code,
    message: presentation.message,
    details:
      result.code === "task_not_found"
        ? { taskId }
        : {
            taskId,
            ...(result.validationRunId === undefined
              ? {}
              : { validationRunId: result.validationRunId }),
            ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
            ...(result.recoveryEvidence === undefined
              ? {}
              : { recoveryEvidence: result.recoveryEvidence }),
          },
    help: presentation.help,
  });
};
