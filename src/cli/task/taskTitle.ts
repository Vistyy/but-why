import type { CliResult } from "../../cliResults.js";
import { usageError } from "../../cliResults.js";
import type { TaskTitleValidationResult } from "../../task/taskTitle.js";

export const taskTitleInputError = (
  error: Extract<TaskTitleValidationResult, { readonly ok: false }>,
): CliResult =>
  usageError(
    error.code === "empty_title"
      ? {
          code: error.code,
          message: "Task title must not be empty.",
          help: ['Provide a non-empty title with `--title "..."`.'],
        }
      : {
          code: error.code,
          message: "Task title must be one line.",
          help: ['Provide a one-line title with `--title "..."`.'],
        },
  );
