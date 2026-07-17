import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { TaskContextDraftReadError } from "../../../task/files/contextDraft.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";

export const runContextApplyCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task context apply <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task context apply BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task context apply <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.applyTaskContextDraft({
      taskId: taskId.taskId,
      now: environment.now().toISOString(),
    });

    if (result.ok) {
      return success({ task: result.task });
    }

    if ("error" in result) {
      return taskContextDraftReadError(result.error);
    }

    if (result.code === "task_not_found") {
      return taskNotFound(taskId.taskId);
    }

    if (result.code === "task_context_draft_cleanup_failed") {
      return runtimeError({
        code: result.code,
        message: "Task Context was updated, but its draft could not be removed.",
        details: { task: result.task, path: result.path },
        help: ["Remove the draft file after confirming the updated Task Context."],
      });
    }

    return invalidTaskContextDraftState(taskId.taskId, result.state);
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};

const invalidTaskContextDraftState = (taskId: PublicTaskId, state: string): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot apply a Task Context draft to task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: ["Apply Task Context drafts before starting the Task."],
  });

const taskContextDraftReadError = (error: TaskContextDraftReadError): CliResult => {
  switch (error.code) {
    case "task_context_draft_not_found":
      return runtimeError({
        code: error.code,
        message: "Task Context draft was not found.",
        details: { path: error.path },
        help: ["Run `by task context draft <task-id>` to create a Task Context draft."],
      });
    case "task_context_draft_unreadable":
      return runtimeError({
        code: error.code,
        message: "Task Context draft is not readable UTF-8 text.",
        details: { path: error.path },
        help: ["Use a readable UTF-8 Task Context draft, then rerun the command."],
      });
    case "invalid_task_context_draft":
      return runtimeError({
        code: error.code,
        message:
          "Task Context draft must start with a non-empty # title and include a description.",
        details: { path: error.path },
        help: ["Fix the draft, then rerun `by task context apply <task-id>`."],
      });
  }
};
