import { type InstructionsReadResult, readInstructionsFile } from "./instructionsFile.js";

export type AcceptanceInstructionsReadResult = InstructionsReadResult;

export const readAcceptanceInstructions = (path: string): AcceptanceInstructionsReadResult => {
  const result = readInstructionsFile(path);
  if (result.ok) return result;
  return {
    ok: false,
    message: result.message
      .replace("Instructions file is empty:", "Acceptance instructions file is empty:")
      .replace("Could not read instructions file", "Could not read Acceptance instructions file"),
  };
};
