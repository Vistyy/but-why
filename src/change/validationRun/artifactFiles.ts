import { dirname, join } from "node:path";
import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";

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
}): Effect.Effect<ValidationArtifactFile, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = join(input.validationRunId, input.phase, input.producer, input.fileName);
    const absolutePath = join(input.artifactsRoot, path);

    yield* fileSystem.makeDirectory(dirname(absolutePath), { recursive: true });
    const bytes = Buffer.from(input.content, "utf8");
    const stored = bytes.subarray(0, input.maxBytes ?? bytes.length);
    yield* fileSystem.writeFile(absolutePath, stored);

    return {
      path,
      originalBytes: bytes.length,
      storedBytes: stored.length,
      truncated: bytes.length > stored.length,
    };
  });

export type ValidationArtifactFile = {
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
};
