import { readFileSync } from "node:fs";

export type InstructionsReadResult =
  | { readonly ok: true; readonly instructions: string }
  | { readonly ok: false; readonly message: string };

export const readInstructionsFile = (path: string): InstructionsReadResult => {
  try {
    const instructions = readFileSync(path, "utf8");
    return instructions.trim().length === 0
      ? { ok: false, message: `Instructions file is empty: ${path}` }
      : { ok: true, instructions };
  } catch (error) {
    return {
      ok: false,
      message: `Could not read instructions file ${path}: ${errorMessage(error)}`,
    };
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
