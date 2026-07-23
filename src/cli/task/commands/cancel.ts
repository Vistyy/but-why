import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success, usageError } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { TaskCancellationResult } from "../../../change/cancelChange.js";
import { withCancellation } from "../../../change/loadChangeCancellation.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import type { TaskCommandEnvironment } from "../taskCliSupport.js";

export const runCancelCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by task cancel <task-id> --reason <reason>",
        arguments: [{ argument: "<task-id>", description: "Public Task ID, such as BY-1" }],
        flags: withGlobalHelpFlags([
          { flag: "--reason <reason>", description: "Why the unfinished Task is being cancelled." },
        ]),
        examples: ['by task cancel BY-1 --reason "No longer needed"'],
      }),
    );
  }

  if (args.length !== 3 || args[1] !== "--reason" || args[2] === undefined) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Task Cancel requires a Task ID and a non-empty --reason.",
        help: ["Run `by task cancel <task-id> --reason <reason>`."],
      }),
    );
  }
  if (args[2].trim().length === 0) {
    return Effect.succeed(
      usageError({
        code: "empty_reason",
        message: "Task cancellation requires a non-empty reason.",
        help: ["Provide a non-empty value for `--reason`."],
      }),
    );
  }

  const parsed = parseCliTaskIdValue(args[0] ?? "");
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withCancellation(
    {
      cwd: environment.cwd,
      ...(environment.cancellationUseCases === undefined
        ? {}
        : { cancellationUseCases: environment.cancellationUseCases }),
    },
    (cancellation) =>
      Effect.map(
        cancellation.cancelTask({
          taskId: parsed.taskId,
          reason: args[2] as string,
          now: environment.now().toISOString(),
        }),
        (result) => cancelResult(parsed.taskId, result),
      ),
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
      help: ["Run `by task list --all` to see known Tasks."],
    });
  }
  const messages: Record<Exclude<TaskCancellationResult, { readonly ok: true }>["code"], string> = {
    task_not_found: `Task was not found: ${taskId}`,
    change_not_found: `Change for Task ${taskId} was not found.`,
    task_already_done: `Cannot cancel completed Task ${taskId}.`,
    change_already_completed: `Task ${taskId} is already complete through its Change.`,
    github_pull_request_unavailable: "The owned pull request could not be read.",
    owned_pull_request_mismatch: "The owned pull request does not match the recorded Change facts.",
    github_close_failed: "The owned pull request could not be closed.",
  };
  return runtimeError({
    code: result.code,
    message: messages[result.code],
    details: { taskId },
    help:
      result.code === "github_close_failed"
        ? ["Resolve the GitHub issue, then retry Task Cancel."]
        : result.code === "owned_pull_request_mismatch"
          ? ["Inspect the Change and resolve the remote mismatch before retrying."]
          : ["Only unfinished Tasks can be cancelled."],
  });
};
