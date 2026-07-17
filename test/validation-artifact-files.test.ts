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
    const path = writeValidationRunArtifactFile({
      artifactsRoot: root,
      validationRunId: "run",
      phase: "checks",
      producer: "check",
      fileName: "stdout.txt",
      content: "x".repeat(maxValidationArtifactBytes + 1),
    });

    expect(Buffer.byteLength(readFileSync(`${root}/${path}`, "utf8"))).toBe(
      maxValidationArtifactBytes,
    );
  });
});
