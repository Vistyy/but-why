import { readFileSync } from "node:fs";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  maxValidationArtifactBytes,
  writeValidationRunArtifactFile,
} from "../../src/change/validationRun/artifactFiles.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

it.layer(NodeFileSystem.layer)((it) => {
  describe("Validation Run artifacts", () => {
    it.effect("bounds stored artifact content", () =>
      Effect.gen(function* () {
        const root = createTestWorkspace();
        const artifact = yield* writeValidationRunArtifactFile({
          artifactsRoot: root,
          validationRunId: "run",
          phase: "checks",
          producer: "check",
          fileName: "stdout.txt",
          content: "x".repeat(maxValidationArtifactBytes + 1),
          maxBytes: maxValidationArtifactBytes,
        });

        expect(Buffer.byteLength(readFileSync(`${root}/${artifact.path}`, "utf8"))).toBe(
          maxValidationArtifactBytes,
        );
        expect(artifact).toMatchObject({
          originalBytes: maxValidationArtifactBytes + 1,
          storedBytes: maxValidationArtifactBytes,
          truncated: true,
        });
      }),
    );
  });
});
