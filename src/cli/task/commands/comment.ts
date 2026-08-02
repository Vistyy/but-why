// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import { readCommentFile, type CommentFileReadError } from "../../../task/files/commentFile.js";
import type { PublicTaskId } from "../../../task/taskId.js";
import {
  resolveTaskId,
  withTasks,
  taskNotFound,
  type TaskCommandEnvironment,
} from "../taskCliSupport.js";

export type TaskCommentCommand = {
  readonly taskId: string;
  readonly file: string;
};

export const runCommentCommand = (
  command: TaskCommentCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsedTaskId = parseCliTaskIdValue(command.taskId);
  if (!parsedTaskId.ok) return Effect.succeed(parsedTaskId.result);

  return withTasks(environment, false, (tasks) => {
    const taskId = resolveTaskId(tasks, parsedTaskId.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.flatMap(tasks.getTaskById(taskId.taskId), (task) => {
      if (task === undefined) return Effect.succeed(taskNotFound(taskId.taskId));
      const comment = readCommentFile(environment.cwd, command.file, environment.stdin);
      if (!comment.ok) return Effect.succeed(commentFileError(comment.error));
      return Effect.map(
        tasks.appendTaskComment({
          taskId: taskId.taskId,
          content: comment.content,
          now: () => environment.now().toISOString(),
        }),
        (result) => {
          if (!result.ok) {
            return result.code === "task_not_found"
              ? taskNotFound(taskId.taskId)
              : invalidTaskCommentState(taskId.taskId, result.state);
          }
          return success({ task: { id: result.taskId, commentCount: result.commentCount } });
        },
      );
    });
  });
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
    case "stdin_is_terminal":
      return runtimeError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with --file -."],
      });
  }
};
