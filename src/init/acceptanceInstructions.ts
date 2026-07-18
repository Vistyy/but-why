import { readFileSync } from "node:fs";

export type AcceptanceInstructionsReadResult =
  | { readonly ok: true; readonly instructions: string }
  | { readonly ok: false; readonly message: string };

export const readAcceptanceInstructions = (path: string): AcceptanceInstructionsReadResult => {
  try {
    const instructions = readFileSync(path, "utf8");
    return instructions.trim().length === 0
      ? { ok: false, message: `Acceptance instructions file is empty: ${path}` }
      : { ok: true, instructions };
  } catch (error) {
    return {
      ok: false,
      message: `Could not read Acceptance instructions file ${path}: ${errorMessage(error)}`,
    };
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
