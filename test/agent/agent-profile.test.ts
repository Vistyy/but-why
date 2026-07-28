import { describe, expect, it } from "vitest";

import {
  resolveAgentProfile,
  resolveInteractiveSessionAgentProfile,
} from "../../src/agent/agentProfiles.js";

const piProfile = (model?: string) => ({
  agentRuntime: "pi" as const,
  ...(model === undefined ? {} : { runtimeConfig: { model } }),
});

describe("Agent Profiles", () => {
  it("resolves an explicit Repo profile only in its declared scope", () => {
    expect(
      resolveAgentProfile({
        repoSelection: { scope: "repo", name: "review" },
        globalSelection: { scope: "global", name: "review" },
        repoProfiles: { review: piProfile("repo-model") },
        globalProfiles: { review: piProfile("global-model") },
      }),
    ).toMatchObject({
      ok: true,
      resolved: { agentProfile: "review", scope: "repo", profile: piProfile("repo-model") },
    });
  });

  it("uses the Global default and ignores a same-named Repo profile", () => {
    expect(
      resolveAgentProfile({
        defaultSelection: { scope: "global", name: "pi" },
        repoProfiles: { pi: piProfile("repo-model") },
        globalProfiles: { pi: piProfile("global-model") },
      }),
    ).toMatchObject({
      ok: true,
      resolved: { agentProfile: "pi", scope: "global", profile: piProfile("global-model") },
    });
  });

  it("resolves an Interactive Session profile from Repo Config before Global Config", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        repoConfig: {
          taskPrefix: "BY",
          interactiveSession: { agentProfile: { scope: "repo", name: "implementation" } },
          agentProfiles: { implementation: piProfile("repo-model") },
        },
        globalConfig: {
          interactiveSession: { agentProfile: { scope: "global", name: "implementation" } },
          agentProfiles: { implementation: piProfile("global-model") },
        },
      }),
    ).toMatchObject({
      ok: true,
      profile: { agentProfile: "implementation", scope: "repo", profile: piProfile("repo-model") },
    });
  });

  it("uses the Global default when neither Interactive Session selection exists", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        repoConfig: { taskPrefix: "BY" },
        globalConfig: {
          defaultAgentProfile: { scope: "global", name: "review" },
          agentProfiles: { review: piProfile("review-model") },
        },
      }),
    ).toMatchObject({
      ok: true,
      profile: { agentProfile: "review", scope: "global", profile: piProfile("review-model") },
    });
  });

  it("preserves Pi defaults when no profile is selected", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        repoConfig: { taskPrefix: "BY" },
        globalConfig: {},
      }),
    ).toEqual({ ok: true, profile: undefined });
  });

  it.each([
    [
      "a missing scoped profile",
      {
        repoSelection: { scope: "repo" as const, name: "missing" },
        repoProfiles: {},
      },
      "MissingAgentProfile",
    ],
    [
      "a missing required model",
      {
        defaultSelection: { scope: "global" as const, name: "review" },
        globalProfiles: { review: piProfile() },
      },
      "MissingAgentModel",
    ],
  ] as const)("returns a typed error for %s", (_name, input, tag) => {
    const result = resolveAgentProfile(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe(tag);
  });
});
