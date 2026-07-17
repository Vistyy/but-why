import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import type { TaskState } from "../../../task/lifecycle.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import { resolveTaskIdArg, taskNotFound, type TaskCommandEnvironment } from "../taskCliSupport.js";
import { taskStartStateHelpFor } from "../taskStateHelp.js";

export const runStartCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task start <task-id>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags(),
      examples: ["by task start BY-1"],
    });
  }

  const taskId = resolveTaskIdArg(args, environment, "by task start <task-id>");

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    const result = taskId.tasks.startTask(taskId.taskId, environment.now().toISOString());

    if (!result.ok) {
      if (result.code === "task_not_found") {
        return taskNotFound(taskId.taskId);
      }

      if (result.code === "task_dependencies_unsatisfied") {
        return runtimeError({
          code: result.code,
          message: `Cannot start task ${taskId.taskId} because prerequisites are incomplete.`,
          details: { taskId: taskId.taskId, blockedBy: result.blockedBy },
          help: ["Complete every prerequisite, then run the Task Start command again."],
        });
      }

      if (result.code === "invalid_task_state") {
        return invalidTaskStart(taskId.taskId, result.state);
      }

      return taskStartOperationalError(taskId.taskId, result.code, result);
    }

    return success({
      task: {
        id: result.task.id,
        state: result.task.state,
        changed: result.changed,
        updatedAt: result.task.updatedAt,
      },
      change: { id: result.changeId },
      branch: result.branchRef,
      startingCommit: result.startingCommit,
      worktreePath: result.worktreePath,
      next: {
        workingDirectory: result.worktreePath,
        command: `by submit ${result.task.id}`,
      },
    });
  } catch {
    return stateStoreUnavailable(taskId.tasks.taskPrefix);
  }
};

const invalidTaskStart = (taskId: PublicTaskId, state: TaskState): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot start task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: [taskStartStateHelpFor(taskId, state)],
  });

const taskStartOperationalError = (
  taskId: PublicTaskId,
  code: string,
  details: {
    readonly changeId?: string;
    readonly branchRef?: string;
    readonly startingCommit?: string;
    readonly worktreePath?: string;
  },
): CliResult => {
  const errors: Record<string, { readonly message: string; readonly help: string }> = {
    local_default_branch_missing: {
      message: "Local Git does not record a default branch.",
      help: "Set a remote HEAD to the repository default branch, then run Task Start again.",
    },
    local_default_branch_ambiguous: {
      message: "Local Git records more than one default branch.",
      help: "Make the recorded remote default branches agree, then run Task Start again.",
    },
    local_default_branch_unavailable: {
      message: "The recorded local default branch is unavailable.",
      help: "Create the recorded default branch locally, then run Task Start again.",
    },
    committed_repo_config_missing: {
      message: "The default branch does not contain .but-why/config.json.",
      help: "Commit .but-why/config.json to the default branch, then run Task Start again.",
    },
    committed_repo_config_invalid: {
      message: "The default branch contains an invalid .but-why/config.json.",
      help: "Fix and commit .but-why/config.json on the default branch, then run Task Start again.",
    },
    task_start_conflict: {
      message: "The Task branch or worktree conflicts with the recorded Task Start.",
      help: "Inspect the recorded branch and worktree path without deleting or overwriting them.",
    },
    git_tooling_error: {
      message: "Git could not provision the managed Task worktree.",
      help: "Fix the Git or filesystem error, then run Task Start again to recover.",
    },
  };
  const error = errors[code];
  if (error === undefined) throw new Error(`Unknown Task Start error: ${code}`);
  return runtimeError({
    code,
    message: error.message,
    details: {
      taskId,
      ...(typeof details.changeId === "string" ? { changeId: details.changeId } : {}),
      ...(typeof details.branchRef === "string" ? { branch: details.branchRef } : {}),
      ...(typeof details.startingCommit === "string"
        ? { startingCommit: details.startingCommit }
        : {}),
      ...(typeof details.worktreePath === "string" ? { worktreePath: details.worktreePath } : {}),
    },
    help: [error.help],
  });
};
