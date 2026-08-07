import type { CliResult } from "./cli.js";
import { runtimeError, usageError } from "./cliResults.js";
import type { RepoTaskIdResolution } from "./task/repoTaskIds.js";
import {
  type PublicTaskId,
  type PublicTaskIdParseResult,
  parsePublicTaskId,
} from "./task/taskId.js";

export type CliTaskIdParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

export const parseCliTaskIdValue = (taskId: string): CliTaskIdParseResult => {
  const parsed = parsePublicTaskId(taskId);

  if (!parsed.ok) {
    return invalidTaskId(taskId, parsed);
  }

  return { ok: true, taskId: parsed.taskId };
};

export const taskIdResolutionError = (
  resolution: Extract<RepoTaskIdResolution, { readonly ok: false }>,
): CliResult =>
  runtimeError({
    code: resolution.code,
    message: `Remote-backed Tasks are not supported yet: ${resolution.taskId}`,
    details: { taskId: resolution.taskId },
    help: [resolution.help],
  });

const invalidTaskId = (
  taskId: string,
  error: Exclude<PublicTaskIdParseResult, { readonly ok: true }>,
): CliTaskIdParseResult => ({
  ok: false,
  result: usageError({
    code: "invalid_task_id",
    message: `Invalid Task ID: ${taskId}`,
    details: {
      taskId,
      reason: error.code,
      ...(error.code === "task_id_too_long" ? { maxLength: error.maxLength } : {}),
    },
    help: ["Use a non-empty Task ID with no surrounding whitespace or control characters."],
  }),
});
