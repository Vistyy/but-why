import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { decodeGlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig } from "../../src/contracts/repoConfig.js";

describe("configuration contracts", () => {
  it("decodes Pi Agent Profile runtimeConfig", () => {
    const config = {
      agentProfiles: {
        pi: {
          agentRuntime: "pi",
          runtimeConfig: {
            model: "openai-codex/gpt-5.5",
            thinking: "xhigh",
            extensions: [],
            skills: [],
            tools: [],
            contextFileDiscovery: false,
          },
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("rejects non-Pi Agent Profiles", () => {
    const error = left(decodeGlobalConfig({ agentProfiles: { other: { agentRuntime: "codex" } } }));

    expect(error._tag).toBe("GlobalConfigValidationFailed");
  });

  it("rejects non-canonical Pi thinking", () => {
    const error = left(
      decodeGlobalConfig({
        agentProfiles: {
          default: {
            agentRuntime: "pi",
            runtimeConfig: { model: "openai-codex/gpt-5.5", thinking: "extended" },
          },
        },
      }),
    );

    expect(error._tag).toBe("GlobalConfigValidationFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });

  it("decodes global Agent Profiles", () => {
    const config = {
      defaultAgentProfile: { scope: "global", name: "default" },
      agentProfiles: {
        default: {
          agentRuntime: "pi",
          runtimeConfig: { model: "openai-codex/gpt-5.5", thinking: "xhigh" },
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("decodes the Global Interactive Session Agent Profile selection", () => {
    const config = {
      interactiveSession: { agentProfile: { scope: "global", name: "implementation" } },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("decodes the Repo Interactive Session Agent Profile selection", () => {
    const config = {
      idPrefix: "BY",
      interactiveSession: { agentProfile: { scope: "repo", name: "implementation" } },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("decodes Global Task Review overrides", () => {
    const config = {
      review: {
        task: {
          instructionsFile: "reviewers/task.md",
          agentProfile: { scope: "global", name: "strict" },
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("decodes global Acceptance overrides", () => {
    const config = {
      review: {
        acceptance: {
          instructionsFile: "reviewers/acceptance.md",
          agentProfile: { scope: "global", name: "strict" },
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("decodes reusable Global Specialists", () => {
    const config = {
      review: { specialists: ["standards"] },
      reviewers: {
        standards: {
          instructionsFile: "reviewers/standards.md",
          agentProfile: { scope: "global", name: "strict" },
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("reports invalid global Agent Profiles with actionable diagnostics", () => {
    const error = left(
      decodeGlobalConfig({
        agentProfiles: {
          default: { agentModel: "openai-codex/gpt-5.5" },
        },
      }),
    );

    expect(error._tag).toBe("GlobalConfigValidationFailed");
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        path: ["agentProfiles", "default", "agentModel"],
        message: "Unknown key.",
      }),
    );
  });

  it("decodes repo validation and reviewer policy", () => {
    const config = {
      idPrefix: "BY",
      prepare: { command: "pnpm install", timeoutSeconds: 60 },
      validation: {
        checks: [{ id: "quality", command: "just quality", timeoutSeconds: 120 }],
      },
      review: {
        acceptance: {
          agentProfile: { scope: "repo", name: "default" },
          instructionsFile: ".but-why/reviewers/acceptance.md",
        },
        specialists: ["bugs"],
      },
      reviewers: {
        bugs: {
          agentProfile: { scope: "repo", name: "default" },
          instructionsFile: ".but-why/reviewers/bugs.md",
        },
      },
      agentProfiles: {
        default: {
          agentRuntime: "pi",
          runtimeConfig: {
            model: "openai-codex/gpt-5.5",
            thinking: "medium",
            extensions: ["npm:@acme/reviewer-extension"],
            skills: ["github:acme/reviewer-skill"],
          },
        },
      },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("rejects unsafe repository Agent resource paths", () => {
    const error = left(
      decodeRepoConfig({
        idPrefix: "BY",
        agentProfiles: {
          unsafe: {
            agentRuntime: "pi",
            runtimeConfig: { skills: ["../outside/skill"] },
          },
        },
      }),
    );

    expect(error._tag).toBe("RepoConfigValidationFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects validation-scoped preparation", () => {
    const error = left(
      decodeRepoConfig({
        idPrefix: "BY",
        validation: { prepare: { command: "pnpm install" } },
      }),
    );

    expect(error._tag).toBe("RepoConfigValidationFailed");
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({ path: ["validation", "prepare"] }),
    );
  });

  it("decodes a repository Agent Environment command", () => {
    const config = {
      idPrefix: "BY",
      agentEnvironment: { command: ["nix", "develop", "-c"] },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("decodes repository Task Review overrides", () => {
    const config = {
      idPrefix: "BY",
      review: {
        task: {
          instructionsFile: ".but-why/reviewers/task.md",
          agentProfile: { scope: "repo", name: "strict" },
        },
      },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("decodes repository Acceptance overrides", () => {
    const config = {
      idPrefix: "BY",
      review: {
        acceptance: {
          instructionsFile: ".but-why/reviewers/acceptance.md",
          agentProfile: { scope: "global", name: "strict" },
        },
      },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("decodes an empty Repo Specialist list that disables inherited Specialists", () => {
    const config = {
      idPrefix: "BY",
      review: { specialists: [] },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("requires instructions in Global Specialist definitions", () => {
    const error = left(
      decodeGlobalConfig({
        review: { specialists: ["standards"] },
        reviewers: { standards: { agentProfile: { scope: "global", name: "strict" } } },
      }),
    );

    expect(error._tag).toBe("GlobalConfigValidationFailed");
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({ path: ["reviewers", "standards", "instructionsFile"] }),
    );
  });

  it("reports actionable repo config diagnostics", () => {
    const error = left(
      decodeRepoConfig({
        idPrefix: "BY",
        validation: { checks: [{ id: "quality", command: "" }] },
      }),
    );

    expect(error._tag).toBe("RepoConfigValidationFailed");
    expect(error.diagnostics).toEqual([
      {
        path: ["validation", "checks", 0, "command"],
        expected: "a non-empty string",
        actual: "",
        message: "Expected a non-empty string.",
      },
    ]);
    expect(error.message).toContain("validation.checks.0.command");
  });

  it.each([
    ["unknown keys", { idPrefix: "BY", ignorePatterns: ["dist/**"] }],
    [
      "empty profile names",
      {
        idPrefix: "BY",
        agentProfiles: { "": { agentRuntime: "pi", runtimeConfig: { model: "model" } } },
      },
    ],
  ])("rejects repo config with %s", (_name, input) => {
    const error = left(decodeRepoConfig(input));

    expect(error._tag).toBe("RepoConfigValidationFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("repository configuration rejection matrix", () => {
  it.each([
    ["missing idPrefix", {}],
    ["non-string idPrefix", { idPrefix: 123 }],
    ["invalid existing idPrefix", { idPrefix: "B" }],
    ["extra key", { idPrefix: "BY", extra: true }],
    ["unknown review key", { idPrefix: "BY", review: { unsupported: true } }],
    ["top-level checks", { idPrefix: "BY", checks: [{ id: "quality", command: "true" }] }],
    [
      "check severity",
      {
        idPrefix: "BY",
        validation: { checks: [{ id: "quality", command: "true", severity: "high" }] },
      },
    ],
    ["prepare severity", { idPrefix: "BY", prepare: { severity: "high" } }],
    ["empty Agent Environment command", { idPrefix: "BY", agentEnvironment: { command: [] } }],
    [
      "blank Agent Environment command entry",
      { idPrefix: "BY", agentEnvironment: { command: ["   "] } },
    ],
    ["disabled Acceptance Review", { idPrefix: "BY", review: { acceptance: { enabled: false } } }],
    ["validation prepare without command", { idPrefix: "BY", validation: { prepare: {} } }],
    [
      "validation prepare empty command",
      { idPrefix: "BY", validation: { prepare: { command: "   " } } },
    ],
    [
      "validation prepare command array",
      { idPrefix: "BY", validation: { prepare: { command: ["pnpm", "install"] } } },
    ],
    [
      "validation prepare commands array",
      { idPrefix: "BY", validation: { prepare: { commands: ["pnpm install"] } } },
    ],
    [
      "validation prepare zero timeout",
      { idPrefix: "BY", validation: { prepare: { command: "true", timeoutSeconds: 0 } } },
    ],
    [
      "validation prepare decimal timeout",
      { idPrefix: "BY", validation: { prepare: { command: "true", timeoutSeconds: 1.5 } } },
    ],
    [
      "validation prepare extra key",
      { idPrefix: "BY", validation: { prepare: { command: "true", severity: "high" } } },
    ],
  ])("rejects repo config with %s", (_name, input) => {
    const error = left(decodeRepoConfig(input));

    expect(error._tag).toBe("RepoConfigValidationFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });
});

const right = <A, E>(result: Either.Either<A, E>): A => {
  if (Either.isLeft(result)) {
    throw new Error(`Expected Right, received ${String(result.left)}`);
  }

  return result.right;
};

const left = <A, E>(result: Either.Either<A, E>): E => {
  if (Either.isRight(result)) {
    throw new Error("Expected Left");
  }

  return result.left;
};
