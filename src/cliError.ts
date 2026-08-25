import type { StructuredObject } from "./output/structured.js";

export type StructuredErrorInput = {
  readonly code: string;
  readonly message: string;
  readonly details?: StructuredObject;
  readonly help: readonly string[];
};

export type StructuredErrorOutput = {
  readonly error: StructuredObject;
  readonly help: readonly string[];
};

export const structuredError = (input: StructuredErrorInput): StructuredErrorOutput => ({
  error: {
    ...(input.details ?? {}),
    code: input.code,
    message: input.message,
  },
  help: input.help,
});
