import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";

describe("source hierarchy", () => {
  it("groups Change workflows and shared adapters under their documented owners", () => {
    const srcRoot = join(repoRoot, "src");
    const topLevelDirectories = readdirSync(srcRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(topLevelDirectories).toEqual([
      "agent",
      "change",
      "cli",
      "contracts",
      "init",
      "output",
      "repositoryPreparation",
      "sqlite",
      "submissionEnvironment",
      "task",
    ]);

    const changeDirectories = readdirSync(join(srcRoot, "change"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(changeDirectories).toEqual([
      "acceptanceReview",
      "candidate",
      "candidateCapture",
      "candidateValidation",
      "publication",
      "specialistReview",
      "submit",
      "validation",
      "validationRun",
    ]);
  });
});
