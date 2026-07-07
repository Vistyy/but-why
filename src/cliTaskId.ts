import type { CliResult } from "./cli.js";
import { runtimeError, usageError } from "./cliResults.js";
import {
  parsePublicTaskId,
  type PublicTaskId,
  type PublicTaskIdParseResult,
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

type CliTaskIdResolution =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly code: "remote_tasks_not_supported";
      readonly taskId: PublicTaskId;
      readonly help: string;
    };

type UnknownExtraArgCode = "unknown_argument" | "unknown_flag";

type CliTaskIdArgParseInput = {
  readonly missingHelp: string;
  readonly extraHelp: string;
  readonly classifyExtraArg?: (arg: string) => UnknownExtraArgCode;
};

export const parseCliTaskIdArg = (
  args: readonly string[],
  input: CliTaskIdArgParseInput,
): CliTaskIdParseResult => {
  const [taskId, extraArg] = args;

  if (taskId === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: [input.missingHelp],
      }),
    };
  }

  if (extraArg !== undefined) {
    const code = input.classifyExtraArg?.(extraArg) ?? "unknown_argument";

    return {
      ok: false,
      result: usageError({
        code,
        message: `${code === "unknown_flag" ? "Unknown flag" : "Unknown argument"}: ${extraArg}`,
        help: [input.extraHelp],
      }),
    };
  }

  return parseCliTaskIdValue(taskId);
};

export const parseCliTaskIdValue = (taskId: string): CliTaskIdParseResult => {
  const parsed = parsePublicTaskId(taskId);

  if (!parsed.ok) {
    return invalidTaskId(taskId, parsed);
  }

  return { ok: true, taskId: parsed.taskId };
};

export const taskIdResolutionError = (
  resolution: Extract<CliTaskIdResolution, { readonly ok: false }>,
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
