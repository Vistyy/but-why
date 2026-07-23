import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  maxValidationArtifactBytes,
  writeValidationRunArtifactFile,
} from "../../src/change/validationRun/artifactFiles.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Validation Run artifacts", () => {
  it("bounds stored artifact content", () => {
    const root = createTestWorkspace();
    const artifact = writeValidationRunArtifactFile({
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
  });
});
