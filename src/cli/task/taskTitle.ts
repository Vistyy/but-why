import type { CliResult } from "../../cliResults.js";
import { usageError } from "../../cliResults.js";

export type TaskTitleInputResult =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly code: "empty_title" | "invalid_task_title" };

export const normalizeTaskTitle = (title: string): TaskTitleInputResult => {
  const normalized = title.trim();
  if (normalized.length === 0) return { ok: false, code: "empty_title" };
  if (/[\r\n]/u.test(normalized)) return { ok: false, code: "invalid_task_title" };
  return { ok: true, title: normalized };
};

export const taskTitleInputError = (
  error: Extract<TaskTitleInputResult, { readonly ok: false }>,
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
