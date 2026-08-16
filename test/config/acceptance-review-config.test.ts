import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveAcceptanceReviewPolicy } from "../../src/change/acceptanceReview/acceptanceReviewConfig.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const profile = (model: string) => ({
  agentRuntime: "pi" as const,
  runtimeConfig: { model, thinking: "high" as const },
});

const repoConfig = (instructionsFile?: string): RepoConfig => ({
  idPrefix: "BY",
  review: {
    acceptance: {
      agentProfile: { scope: "repo", name: "strict" },
      ...(instructionsFile === undefined ? {} : { instructionsFile }),
    },
  },
  agentProfiles: { strict: profile("repo-model") },
});

const globalConfig = (instructionsFile?: string): GlobalConfig => ({
  defaultAgentProfile: { scope: "global", name: "default" },
  agentProfiles: { default: profile("default-model") },
  ...(instructionsFile === undefined ? {} : { review: { acceptance: { instructionsFile } } }),
});

describe("Acceptance Review configuration", () => {
  it("resolves repository, global, then built-in instructions", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global", "config.json");
    mkdirSync(join(root, "repo", ".but-why", "reviewers"), { recursive: true });
    mkdirSync(join(root, "global", "reviewers"), { recursive: true });
    writeFileSync(join(root, "repo", ".but-why", "reviewers", "acceptance.md"), "repo\n");
    writeFileSync(join(root, "global", "reviewers", "acceptance.md"), "global\n");

    expect(
      resolveAcceptanceReviewPolicy({
        repoConfig: repoConfig(".but-why/reviewers/acceptance.md"),
        globalConfig: globalConfig("reviewers/acceptance.md"),
        repoRoot: join(root, "repo"),
        globalConfigPath,
      }),
    ).toMatchObject({ ok: true, policy: { instructions: "repo\n", instructionsSource: "repo" } });

    expect(
      resolveAcceptanceReviewPolicy({
        repoConfig: { idPrefix: "BY" },
        globalConfig: globalConfig("reviewers/acceptance.md"),
        repoRoot: join(root, "repo"),
        globalConfigPath,
      }),
    ).toMatchObject({ ok: true, policy: { instructions: "global\n" } });

    expect(
      resolveAcceptanceReviewPolicy({
        repoConfig: { idPrefix: "BY" },
        globalConfig: globalConfig(),
        repoRoot: join(root, "repo"),
        globalConfigPath,
      }),
    ).toMatchObject({ ok: true, policy: { instructionsSource: "built_in" } });
  });

  it("returns only instructions, instructionsSource, and profile without resolver metadata", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global", "config.json");
    mkdirSync(join(root, "repo", ".but-why", "reviewers"), { recursive: true });
    mkdirSync(join(root, "global", "reviewers"), { recursive: true });
    writeFileSync(join(root, "repo", ".but-why", "reviewers", "acceptance.md"), "repo\n");

    const result = resolveAcceptanceReviewPolicy({
      repoConfig: repoConfig(".but-why/reviewers/acceptance.md"),
      globalConfig: globalConfig(),
      repoRoot: join(root, "repo"),
      globalConfigPath,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Object.keys(result.policy)).toEqual(["instructions", "instructionsSource", "profile"]);
  });

  it("rejects a configured missing repo instructions file without fallback", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global", "config.json");
    mkdirSync(join(root, "global", "reviewers"), { recursive: true });
    writeFileSync(join(root, "global", "reviewers", "acceptance.md"), "global\n");

    expect(
      resolveAcceptanceReviewPolicy({
        repoConfig: repoConfig(".but-why/reviewers/acceptance.md"),
        globalConfig: globalConfig("reviewers/acceptance.md"),
        repoRoot: join(root, "repo"),
        globalConfigPath,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "InvalidReviewerConfig",
        message: expect.stringContaining("Could not read Acceptance instructions file"),
      },
    });
  });

  it("rejects a configured unreadable instructions file instead of falling back", () => {
    const root = createTestWorkspace();
    const repo = join(root, "repo");
    const globalConfigPath = join(root, "global", "config.json");
    mkdirSync(join(repo, "reviewers", "acceptance.md"), { recursive: true });
    mkdirSync(join(root, "global", "reviewers"), { recursive: true });
    writeFileSync(join(root, "global", "reviewers", "acceptance.md"), "global\n");

    expect(
      resolveAcceptanceReviewPolicy({
        repoConfig: repoConfig("reviewers/acceptance.md"),
        globalConfig: globalConfig("reviewers/acceptance.md"),
        repoRoot: repo,
        globalConfigPath,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "InvalidReviewerConfig",
        message: expect.stringContaining("Could not read Acceptance instructions file"),
      },
    });
  });

  it("resolves scoped repository, global, then default Agent Profile selection", () => {
    const root = createTestWorkspace();
    const profiles = {
      repo: profile("repo-model"),
      global: profile("global-model"),
      default: profile("default-model"),
    } satisfies NonNullable<GlobalConfig["agentProfiles"]>;
    const baseGlobal = {
      defaultAgentProfile: { scope: "global", name: "default" },
      agentProfiles: profiles,
    } satisfies GlobalConfig;
    const resolve = (repo: RepoConfig, global: GlobalConfig) =>
      resolveAcceptanceReviewPolicy({
        repoConfig: repo,
        globalConfig: global,
        repoRoot: root,
        globalConfigPath: join(root, "config.json"),
      });

    expect(
      resolve(
        {
          idPrefix: "BY",
          review: { acceptance: { agentProfile: { scope: "repo", name: "repo" } } },
          agentProfiles: { repo: profiles.repo },
        },
        {
          ...baseGlobal,
          review: { acceptance: { agentProfile: { scope: "global", name: "global" } } },
        },
      ),
    ).toMatchObject({ ok: true, policy: { profile: { agentProfile: "repo", scope: "repo" } } });
    expect(
      resolve(
        { idPrefix: "BY" },
        {
          ...baseGlobal,
          review: { acceptance: { agentProfile: { scope: "global", name: "global" } } },
        },
      ),
    ).toMatchObject({ ok: true, policy: { profile: { agentProfile: "global", scope: "global" } } });
    expect(resolve({ idPrefix: "BY" }, baseGlobal)).toMatchObject({
      ok: true,
      policy: { profile: { agentProfile: "default", scope: "global" } },
    });
  });
});
