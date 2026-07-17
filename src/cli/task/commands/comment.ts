import type { CliResult } from "../../../cliResults.js";
import { runtimeError, stateStoreUnavailable, success, usageError } from "../../../cliResults.js";
import { withGlobalHelpFlags } from "../../../cliHelp.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { readCommentFile, type CommentFileReadError } from "../../../task/files/commentFile.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import {
  loadTasks,
  resolveTaskId,
  taskNotFound,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export const runCommentCommand = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
): CliResult => {
  if (args.length === 1 && args[0] === "--help") {
    return success({
      usage: "by task comment <task-id> --file <file>",
      arguments: [
        {
          argument: "<task-id>",
          description: "Public Task ID, such as BY-1",
        },
      ],
      flags: withGlobalHelpFlags([
        {
          flag: "--file <file>",
          description: "Required UTF-8 Markdown comment file. Stdin is not supported.",
        },
      ]),
      examples: ["by task comment BY-1 --file comment.md"],
    });
  }

  const parseResult = parseTaskCommentArgs(args);

  if (!parseResult.ok) {
    return parseResult.result;
  }

  if (parseResult.commentFile === undefined) {
    return usageError({
      code: "missing_comment_file",
      message: "--file is required.",
      help: ["Run `by task comment <task-id> --file <file>` to append a Task comment."],
    });
  }

  const tasksLoad = loadTasks(environment, false);

  if (!tasksLoad.ok) {
    return tasksLoad.result;
  }

  const taskId = resolveTaskId(tasksLoad.tasks, parseResult.taskId);

  if (!taskId.ok) {
    return taskId.result;
  }

  try {
    if (tasksLoad.tasks.getTaskById(taskId.taskId) === undefined) {
      return taskNotFound(taskId.taskId);
    }
  } catch {
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }

  if (parseResult.commentFile === "-") {
    return runtimeError({
      code: "unsupported_stdin_comment_file",
      message: "Reading Task comments from stdin is not supported in v1.",
      help: ["Write the comment to a file, then rerun `by task comment <task-id> --file <file>`."],
    });
  }

  const comment = readCommentFile(environment.cwd, parseResult.commentFile);

  if (!comment.ok) {
    return commentFileError(comment.error);
  }

  try {
    const result = tasksLoad.tasks.appendTaskComment({
      taskId: taskId.taskId,
      content: comment.content,
      now: () => environment.now().toISOString(),
    });

    if (!result.ok) {
      if (result.code === "task_not_found") {
        return taskNotFound(taskId.taskId);
      }

      return invalidTaskCommentState(taskId.taskId, result.state);
    }

    return success({
      task: {
        id: result.taskId,
        commentCount: result.commentCount,
      },
    });
  } catch {
    return stateStoreUnavailable(tasksLoad.tasks.taskPrefix);
  }
};

type TaskCommentArgsParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly commentFile: string | undefined;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseTaskCommentArgs = (args: readonly string[]): TaskCommentArgsParseResult => {
  const [taskIdArg, ...rest] = args;

  if (taskIdArg === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: ["Run `by task comment <task-id> --file <file>`."],
      }),
    };
  }

  const parsedTaskId = parseCliTaskIdValue(taskIdArg);

  if (!parsedTaskId.ok) {
    return parsedTaskId;
  }

  let commentFile: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--file") {
      const value = rest[index + 1];

      if (value === undefined) {
        return { ok: true, taskId: parsedTaskId.taskId, commentFile: undefined };
      }

      commentFile = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("-")) {
      return {
        ok: false,
        result: usageError({
          code: "unknown_flag",
          message: `Unknown flag: ${arg}`,
          help: ["Run `by task comment --help`."],
        }),
      };
    }

    return {
      ok: false,
      result: usageError({
        code: "unknown_argument",
        message: `Unknown argument: ${arg ?? ""}`,
        help: ["Run `by task comment --help`."],
      }),
    };
  }

  return { ok: true, taskId: parsedTaskId.taskId, commentFile };
};

const invalidTaskCommentState = (taskId: PublicTaskId, state: string): CliResult =>
  runtimeError({
    code: "invalid_task_state",
    message: `Cannot append a Task comment to task ${taskId} from state ${state}`,
    details: { taskId, state },
    help: ["Task comments may be appended before starting the Task."],
  });

const commentFileError = (error: CommentFileReadError): CliResult => {
  switch (error.code) {
    case "comment_file_not_found":
      return runtimeError({
        code: error.code,
        message: "Task comment file was not found.",
        details: { path: error.path },
        help: ["Create the file, then rerun `by task comment <task-id> --file <file>`."],
      });
    case "comment_file_unreadable":
      return runtimeError({
        code: error.code,
        message: "Task comment file is not readable UTF-8 text.",
        details: { path: error.path },
        help: ["Use a readable UTF-8 file for `--file`."],
      });
    case "empty_comment":
      return runtimeError({
        code: error.code,
        message: "Task comment must not be empty.",
        details: { path: error.path },
        help: ["Write a non-empty comment file and rerun the command."],
      });
  }
};
