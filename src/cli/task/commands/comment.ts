// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliResult } from "../../../cliResults.js";
import { runtimeError, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  readRecordingText,
  type RecordingTextReadError,
} from "../../../cli/input/recordingText.js";
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
      const comment = readRecordingText(environment.cwd, command.file, environment.stdin);
      if (!comment.ok) return Effect.succeed(commentInputError(comment.error));
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
          return success({
            task: {
              id: result.taskId,
              state: result.state,
              commentCount: result.commentCount,
              updatedAt: result.updatedAt,
            },
            content: result.content,
          });
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

const commentInputError = (error: RecordingTextReadError): CliResult => {
  switch (error.code) {
    case "recording_text_file_not_found":
      return runtimeError({
        code: "comment_input_not_found",
        message: "Task comment file was not found.",
        details: { path: error.path },
        help: ["Create the file, then rerun `by task comment <task-id> --file <path|->`."],
      });
    case "recording_text_file_unreadable":
    case "recording_text_stdin_unreadable":
      return runtimeError({
        code: "comment_input_unreadable",
        message: "Task comment input is not readable.",
        details: "path" in error ? { path: error.path } : { path: "-" },
        help: ["Use a readable UTF-8 file or pipe UTF-8 text with `--file -`."],
      });
    case "recording_text_invalid_utf8":
      return runtimeError({
        code: "invalid_comment_encoding",
        message: "Task comment input must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the input as UTF-8 and rerun the command."],
      });
    case "recording_text_too_large":
      return runtimeError({
        code: "comment_input_too_large",
        message: "Task comment input is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the input to 256 KiB or less."],
      });
    case "recording_text_blank":
      return runtimeError({
        code: "empty_comment",
        message: "Task comment must not be blank.",
        details: { path: error.path },
        help: ["Provide non-blank text with `--file <path|->`."],
      });
    case "stdin_is_terminal":
      return runtimeError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with `--file -`."],
      });
  }
};
