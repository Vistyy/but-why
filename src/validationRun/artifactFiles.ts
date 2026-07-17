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
  readonly maxBytes?: number;
}): ValidationArtifactFile => {
  const path = join(input.validationRunId, input.phase, input.producer, input.fileName);
  const absolutePath = join(input.artifactsRoot, path);

  mkdirSync(dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(input.content, "utf8");
  const stored = bytes.subarray(0, input.maxBytes ?? bytes.length);
  writeFileSync(absolutePath, stored);

  return {
    path,
    originalBytes: bytes.length,
    storedBytes: stored.length,
    truncated: bytes.length > stored.length,
  };
};

export type ValidationArtifactFile = {
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
};
