import { describe, expect, it } from "vitest";

import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { submitRepoConfig } from "../../src/submit/submitRepoConfig.js";

const checkConfig = {
  taskPrefix: "BY",
  validation: { checks: [{ id: "quality", command: "true" }] },
} satisfies RepoConfig;

describe("submit repository configuration", () => {
  it("resolves selected reviewers from global Agent Profiles", () => {
    const config = {
      ...checkConfig,
      review: { intent: { reviewer: "intent" } },
      reviewers: {
        intent: {
          agentProfile: "default",
          instructionsFile: ".but-why/reviewers/intent.md",
        },
      },
    } satisfies RepoConfig;
    const globalConfig = {
      agentProfiles: {
        default: { agentRuntime: "pi", agentModel: "openai-codex/gpt-5.5" },
      },
    } satisfies GlobalConfig;

    expect(submitRepoConfig(config, globalConfig)).toEqual({
      ok: true,
      config: {
        sandboxMode: "none",
        checks: [{ id: "quality", command: "true", timeoutSeconds: 1200 }],
        intentReviewer: {
          id: "intent",
          instructionsFile: ".but-why/reviewers/intent.md",
          agentRuntime: "pi",
          agentModel: "openai-codex/gpt-5.5",
        },
      },
    });
  });

  it("ignores unused Agent Profiles", () => {
    expect(
      submitRepoConfig(checkConfig, {
        agentProfiles: { default: { agentRuntime: "pi" } },
      }),
    ).toEqual({
      ok: true,
      config: {
        sandboxMode: "none",
        checks: [{ id: "quality", command: "true", timeoutSeconds: 1200 }],
      },
    });
  });

  it("rejects a selected reviewer whose Agent Profile is unavailable", () => {
    const result = submitRepoConfig(
      {
        ...checkConfig,
        review: { intent: { reviewer: "intent" } },
        reviewers: {
          intent: {
            agentProfile: "missing",
            instructionsFile: ".but-why/reviewers/intent.md",
          },
        },
      },
      {},
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "MissingAgentProfile", profileName: "missing" },
    });
  });

  it("rejects missing and duplicate validation checks", () => {
    expect(submitRepoConfig({ taskPrefix: "BY" }, {})).toMatchObject({
      ok: false,
      error: {
        _tag: "RepoConfigValidationFailed",
        message: "Repo config must define at least one validation.checks entry.",
      },
    });

    expect(
      submitRepoConfig(
        {
          taskPrefix: "BY",
          validation: {
            checks: [
              { id: "quality", command: "true" },
              { id: "quality", command: "false" },
            ],
          },
        },
        {},
      ),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "RepoConfigValidationFailed",
        message: "Duplicate check id: quality",
      },
    });
  });
});
