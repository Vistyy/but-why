import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ValidationPhase } from "./validationRun.js";

export const writeValidationRunArtifactFile = (input: {
  readonly artifactsRoot: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly fileName: string;
  readonly content: string;
}): string => {
  const path = join(input.validationRunId, input.phase, input.producer, input.fileName);
  const absolutePath = join(input.artifactsRoot, path);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, input.content);

  return path;
};
