import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCandidateRepoConfig } from "../../src/repositoryRuntime/validateCandidateRepoConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Candidate Repo Config validation", () => {
  it("validates the tracked config with the Candidate contract", () => {
    const root = createTestWorkspace();
    mkdirSync(join(root, ".but-why"));
    const path = join(root, ".but-why", "config.json");
    writeFileSync(path, '{"taskPrefix":"BY"}\n');

    expect(validateCandidateRepoConfig(root)).toEqual({ ok: true });

    writeFileSync(path, '{"newerPrefix":"BY"}\n');
    expect(validateCandidateRepoConfig(root)).toMatchObject({
      ok: false,
      path,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: ["newerPrefix"], message: "Unknown key." }),
      ]),
    });
  });
});
