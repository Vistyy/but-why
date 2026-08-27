// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { applyTaskContextDraft } from "../../../task/composition/taskContext.js";
import type { TaskContextDraftReadError } from "../../../task/files/contextDraft.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  taskMutationView,
  taskNotFound,
  withTasks,
} from "../taskCliSupport.js";

export const runContextApplyCommand = (
  command: { readonly taskId: string },
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (context) => {
    const taskId = resolveTaskId(context, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.map(
      applyTaskContextDraft(environment.cwd, {
        taskId: taskId.taskId,
        now: environment.now().toISOString(),
      }),
      (result) => {
        if (result.ok) {
          return success({ task: taskMutationView(result.task), context: result.context });
        }
        if ("error" in result) return taskContextDraftReadError(result.error);
        if (result.code === "task_not_found") return taskNotFound(taskId.taskId);
        if (result.code === "task_context_draft_cleanup_failed") {
          return runtimeError({
            code: result.code,
            message: "Task Context was updated, but its draft could not be removed.",
            details: { task: result.task, path: result.path },
            help: ["Remove the draft file after confirming the updated Task Context."],
          });
        }
        return invalidTaskContextDraftState(taskId.taskId, result.state);
      },
    );
  });
};

const invalidTaskContextDraftState = (taskId: PublicTaskId, state: string): CliResult => {
  if (state === "todo") {
    return runtimeError({
      code: "task_revision_required",
      message: `Cannot apply a Task Context draft to task ${taskId} until its approved intent is opened for revision.`,
      details: { taskId, state },
      help: [`Run \`by task revise ${taskId}\` before changing approved Task intent.`],
    });
  }
  return runtimeError({
    code: "invalid_task_state",
    message: `Cannot apply a Task Context draft to task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: ["Apply Task Context drafts before starting the Task."],
  });
};

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
        message: "Task Context draft must contain a non-empty description.",
        details: { path: error.path },
        help: ["Fix the draft, then rerun `by task context apply <task-id>`."],
      });
  }
};
