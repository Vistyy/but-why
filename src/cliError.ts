import type { StructuredObject } from "./output/structured.js";

export type StructuredErrorInput = {
  readonly code: string;
  readonly message: string;
  readonly details?: StructuredObject;
  readonly help: readonly string[];
};

export const structuredError = (input: StructuredErrorInput): StructuredObject => ({
  error: {
    code: input.code,
    message: input.message,
    ...(input.details ?? {}),
  },
  help: input.help,
});

export type UsageErrorInput = {
  readonly code: string;
  readonly message: string;
  readonly details?: StructuredObject;
  readonly help: string;
};

export type UsageErrorResult = {
  readonly exitCode: 2;
  readonly stdout: StructuredObject;
};

export const structuredUsageError = (input: UsageErrorInput): StructuredObject =>
  structuredError({
    code: input.code,
    message: input.message,
    ...(input.details === undefined ? {} : { details: input.details }),
    help: [input.help],
  });

export const structuredUsageErrorResult = (input: UsageErrorInput): UsageErrorResult => ({
  exitCode: 2,
  stdout: structuredUsageError(input),
});
