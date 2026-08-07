import { describe, expect, it } from "vitest";
import { submitRepoConfig } from "../../src/change/submit/submitRepoConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";

const checkConfig = {
  taskPrefix: "BY",
  validation: { checks: [{ id: "quality", command: "true" }] },
} satisfies RepoConfig;

describe("submit repository configuration", () => {
  it("normalizes validation settings", () => {
    expect(submitRepoConfig(checkConfig)).toEqual({
      ok: true,
      config: {
        checks: [{ id: "quality", command: "true", timeoutSeconds: 1200 }],
      },
    });
  });

  it("rejects missing and duplicate validation checks", () => {
    expect(submitRepoConfig({ taskPrefix: "BY" })).toMatchObject({
      ok: false,
      error: {
        _tag: "RepoConfigValidationFailed",
        message: "Repo config must define at least one validation.checks entry.",
      },
    });

    expect(
      submitRepoConfig({
        taskPrefix: "BY",
        validation: {
          checks: [
            { id: "quality", command: "true" },
            { id: "quality", command: "false" },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "RepoConfigValidationFailed",
        message: "Duplicate check id: quality",
      },
    });
  });
});
