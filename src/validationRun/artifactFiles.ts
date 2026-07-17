import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ValidationPhase } from "./validationRun.js";

export const maxValidationArtifactBytes = 1_048_576;

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
  writeFileSync(absolutePath, boundedArtifactContent(input.content));

  return path;
};

const boundedArtifactContent = (content: string): Buffer => {
  const bytes = Buffer.from(content, "utf8");
  return bytes.length <= maxValidationArtifactBytes
    ? bytes
    : bytes.subarray(0, maxValidationArtifactBytes);
};
