import { describe, expect, it } from "vitest";

import {
  resolveAgentProfile,
  resolveInteractiveSessionAgentProfile,
} from "../../src/agent/agentProfiles.js";

describe("Agent Profiles", () => {
  it("resolves an explicit profile from Repo Config before Global Config", () => {
    expect(
      resolveAgentProfile({
        agentProfile: "review",
        repoProfiles: {
          review: { agentRuntime: "pi", agentModel: "repo-model" },
        },
        globalConfig: {
          defaultAgentProfile: "global-default",
          agentProfiles: {
            review: { agentRuntime: "codex", agentModel: "global-model" },
          },
        },
      }),
    ).toEqual({
      ok: true,
      resolved: {
        agentProfile: "review",
        source: "repo",
        profile: { agentRuntime: "pi", agentModel: "repo-model" },
      },
    });
  });

  it("uses the Global Config default and ignores a same-named repo profile", () => {
    expect(
      resolveAgentProfile({
        repoProfiles: { pi: { agentRuntime: "pi", agentModel: "repo-model" } },
        globalConfig: {
          defaultAgentProfile: "pi",
          agentProfiles: { pi: { agentRuntime: "pi", agentModel: "global-model" } },
        },
      }),
    ).toEqual({
      ok: true,
      resolved: {
        agentProfile: "pi",
        source: "global",
        profile: { agentRuntime: "pi", agentModel: "global-model" },
      },
    });
  });

  it("resolves an Interactive Session Agent Profile only from Global Config", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        interactiveSession: { agentProfile: "implementation" },
        agentProfiles: {
          implementation: {
            agentRuntime: "pi",
            agentModel: "openai-codex/gpt-5.6-luna",
            thinking: "high",
          },
        },
      }),
    ).toEqual({
      ok: true,
      profile: {
        agentModel: "openai-codex/gpt-5.6-luna",
        thinking: "high",
      },
    });
  });

  it("preserves Pi defaults when no Interactive Session Agent Profile is selected", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        defaultAgentProfile: "review",
        agentProfiles: {
          review: { agentRuntime: "pi", agentModel: "review-model", thinking: "xhigh" },
        },
      }),
    ).toEqual({ ok: true, profile: undefined });
  });

  it.each([
    [
      "a missing Interactive Session profile",
      { interactiveSession: { agentProfile: "missing" } },
      "MissingAgentProfile",
    ],
    [
      "a non-Pi Interactive Session profile",
      {
        interactiveSession: { agentProfile: "implementation" },
        agentProfiles: {
          implementation: { agentRuntime: "codex", agentModel: "model" },
        },
      },
      "UnsupportedAgentRuntime",
    ],
  ] as const)("rejects %s", (_name, globalConfig, tag) => {
    const result = resolveInteractiveSessionAgentProfile(globalConfig);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe(tag);
  });

  it.each([
    ["missing profile", { agentProfile: "missing", globalConfig: {} }, "MissingAgentProfile"],
    [
      "unsupported runtime",
      {
        agentProfile: "review",
        globalConfig: {
          agentProfiles: { review: { agentRuntime: "unknown", agentModel: "model" } },
        },
      },
      "UnsupportedAgentRuntime",
    ],
    [
      "missing required model",
      {
        agentProfile: "review",
        globalConfig: { agentProfiles: { review: { agentRuntime: "pi" } } },
      },
      "MissingAgentModel",
    ],
  ] as const)("returns a typed error for %s", (_name, input, tag) => {
    const result = resolveAgentProfile(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe(tag);
  });
});
