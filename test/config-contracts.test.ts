import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { decodeGlobalConfig } from "../src/contracts/globalConfig.js";
import { decodeRepoConfig } from "../src/contracts/repoConfig.js";

describe("configuration contracts", () => {
  it("decodes runtime-specific Agent Profile thinking", () => {
    const config = {
      agentProfiles: {
        pi: {
          agentRuntime: "pi",
          agentModel: "openai-codex/gpt-5.5",
          thinking: "xhigh",
        },
        other: {
          agentRuntime: "custom-runtime",
          agentModel: "review-model",
          thinking: "extended",
        },
      },
    };

    expect(right(decodeGlobalConfig(config))).toEqual(config);
  });

  it("rejects non-canonical Pi thinking", () => {
    const error = left(
      decodeGlobalConfig({
        agentProfiles: {
          default: {
            agentRuntime: "pi",
            agentModel: "openai-codex/gpt-5.5",
            thinking: "extended",
          },
        },
      }),
    );

    expect(error._tag).toBe("GlobalConfigValidationFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });

  it("decodes global Agent Profiles", () => {
    const config = {
      agentProfiles: {
        default: {
          agentRuntime: "pi",
          agentModel: "openai-codex/gpt-5.5",
          thinking: "xhigh",
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
        path: ["agentProfiles", "default", "agentRuntime"],
        actual: undefined,
        message: "Required value is missing.",
      }),
    );
  });

  it("decodes repo validation and reviewer policy", () => {
    const config = {
      taskPrefix: "BY",
      validation: {
        sandbox: { mode: "docker" },
        prepare: { command: "pnpm install", timeoutSeconds: 60 },
        checks: [{ id: "quality", command: "just quality", timeoutSeconds: 120 }],
      },
      review: {
        intent: { reviewer: "intent" },
        quality: { mode: "parallel", reviewers: ["bugs"] },
      },
      reviewers: {
        intent: {
          profile: "default",
          instructionsFile: ".but-why/reviewers/intent.md",
        },
        bugs: {
          agentRuntime: "pi",
          agentModel: "openai-codex/gpt-5.5",
          thinking: "high",
          instructionsFile: ".but-why/reviewers/bugs.md",
        },
      },
      agentProfiles: {
        default: {
          agentRuntime: "pi",
          agentModel: "openai-codex/gpt-5.5",
          thinking: "medium",
        },
      },
      validationWorkspace: { copyFiles: [".env.test"] },
    };

    expect(right(decodeRepoConfig(config))).toEqual(config);
  });

  it("reports actionable repo config diagnostics", () => {
    const error = left(
      decodeRepoConfig({
        taskPrefix: "BY",
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
    ["unknown keys", { taskPrefix: "BY", ignorePatterns: ["dist/**"] }],
    [
      "empty profile names",
      {
        taskPrefix: "BY",
        agentProfiles: { "": { agentRuntime: "pi", agentModel: "model" } },
      },
    ],
    [
      "profile and inline reviewer settings together",
      {
        taskPrefix: "BY",
        reviewers: {
          intent: {
            profile: "default",
            agentRuntime: "pi",
            agentModel: "openai-codex/gpt-5.5",
            instructionsFile: ".but-why/reviewers/intent.md",
          },
        },
      },
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
