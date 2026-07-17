import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  maxValidationArtifactBytes,
  writeValidationRunArtifactFile,
} from "../src/validationRun/artifactFiles.js";
import { cleanupTempRoots, createTempRoot } from "./support/by-cli.js";

afterEach(cleanupTempRoots);

describe("Validation Run artifacts", () => {
  it("bounds stored artifact content", () => {
    const root = createTempRoot();
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
