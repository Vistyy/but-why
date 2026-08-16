import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveAgentProfile,
  resolveInteractiveSessionAgentProfile,
} from "../../src/agent/agentProfiles.js";
import { piResourceFlags, validatePiAgentProfileResources } from "../../src/agent/piRuntime.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

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
          idPrefix: "BY",
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
        repoConfig: { idPrefix: "BY" },
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

  it("rejects a configured but missing Global default profile", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        repoConfig: { idPrefix: "BY" },
        globalConfig: {
          defaultAgentProfile: { scope: "global", name: "missing" },
          agentProfiles: {},
        },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "MissingAgentProfile",
        profileName: "missing",
        scope: "global",
        selection: "default",
      },
    });
  });

  it("rejects a missing local resource with its profile and resolved path", () => {
    const root = createTestWorkspace();
    const globalConfigDirectory = join(root, "global");
    mkdirSync(globalConfigDirectory, { recursive: true });
    const resolved = resolveAgentProfile({
      defaultSelection: { scope: "global", name: "review" },
      globalProfiles: {
        review: {
          agentRuntime: "pi",
          runtimeConfig: {
            model: "review-model",
            extensions: ["extensions/missing"],
          },
        },
      },
      globalConfigDirectory,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(validatePiAgentProfileResources(resolved.resolved, root)).toMatchObject({
      ok: false,
      error: {
        _tag: "MissingAgentProfileResource",
        profileName: "review",
        scope: "global",
        resourceType: "extension",
        path: join(globalConfigDirectory, "extensions/missing"),
      },
    });
  });

  it("accepts local resources and skips Pi package sources", () => {
    const root = createTestWorkspace();
    const globalConfigDirectory = join(root, "global");
    const extension = join(globalConfigDirectory, "extensions", "review.ts");
    const skill = join(globalConfigDirectory, "skills", "review");
    mkdirSync(join(globalConfigDirectory, "extensions"), { recursive: true });
    mkdirSync(skill, { recursive: true });
    writeFileSync(extension, "export default {};");
    const resolved = resolveAgentProfile({
      defaultSelection: { scope: "global", name: "review" },
      globalProfiles: {
        review: {
          agentRuntime: "pi",
          runtimeConfig: {
            model: "review-model",
            extensions: ["extensions/review.ts", extension, "npm:review-extension@1.0.0"],
            skills: ["skills/review", "~/"],
          },
        },
      },
      globalConfigDirectory,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(validatePiAgentProfileResources(resolved.resolved, root)).toEqual({ ok: true });
  });

  it("deduplicates configured and trusted extensions by canonical physical identity", () => {
    const root = createTestWorkspace();
    const extension = join(root, "extensions", "review.ts");
    const alias = join(root, "extensions", "review-alias.ts");
    mkdirSync(join(root, "extensions"), { recursive: true });
    writeFileSync(extension, "export default {};");
    symlinkSync(extension, alias);

    expect(
      piResourceFlags(
        { extensions: ["extensions/review.ts"] },
        { scope: "repo", repoRoot: root, globalConfigDirectory: undefined },
        { trustedExtensions: [alias] },
      ),
    ).toBe(`--no-extensions --extension '${extension}'`);
  });

  it("resolves Repo resources from the supplied resource root", () => {
    const root = createTestWorkspace();
    const extension = join(root, "extensions", "review.ts");
    mkdirSync(join(root, "extensions"), { recursive: true });
    writeFileSync(extension, "export default {};");
    const resolved = resolveAgentProfile({
      repoSelection: { scope: "repo", name: "review" },
      repoProfiles: {
        review: {
          agentRuntime: "pi",
          runtimeConfig: { model: "review-model", extensions: ["extensions/review.ts"] },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(validatePiAgentProfileResources(resolved.resolved, root)).toEqual({ ok: true });
  });

  it("preserves Pi defaults when no profile is selected", () => {
    expect(
      resolveInteractiveSessionAgentProfile({
        repoConfig: { idPrefix: "BY" },
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
