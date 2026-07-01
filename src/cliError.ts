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
