import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveAcceptanceReviewPolicy } from "../../src/acceptanceReview/acceptanceReviewConfig.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const profile = {
  agentRuntime: "pi" as const,
  agentModel: "openai-codex/gpt-5.5",
  thinking: "high" as const,
};

const repoConfig = (instructionsFile?: string): RepoConfig => ({
  taskPrefix: "BY",
  review: {
    acceptance: {
      agentProfile: "strict",
      ...(instructionsFile === undefined ? {} : { instructionsFile }),
    },
  },
  agentProfiles: { strict: profile },
});

const globalConfig = (instructionsFile?: string): GlobalConfig => ({
  defaultAgentProfile: "default",
  agentProfiles: { default: profile },
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

    const fromRepo = resolveAcceptanceReviewPolicy({
      repoConfig: repoConfig(".but-why/reviewers/acceptance.md"),
      globalConfig: globalConfig("reviewers/acceptance.md"),
      repoRoot: join(root, "repo"),
      globalConfigPath,
    });
    expect(fromRepo).toMatchObject({
      ok: true,
      policy: { instructions: "repo\n", instructionsSource: "repo" },
    });

    const fromGlobal = resolveAcceptanceReviewPolicy({
      repoConfig: repoConfig(),
      globalConfig: globalConfig("reviewers/acceptance.md"),
      repoRoot: join(root, "repo"),
      globalConfigPath,
    });
    expect(fromGlobal).toMatchObject({
      ok: true,
      policy: { instructions: "global\n", instructionsSource: "global" },
    });

    const fromBuiltIn = resolveAcceptanceReviewPolicy({
      repoConfig: repoConfig(),
      globalConfig: globalConfig(),
      repoRoot: join(root, "repo"),
      globalConfigPath,
    });
    expect(fromBuiltIn).toMatchObject({
      ok: true,
      policy: { instructionsSource: "built_in" },
    });
  });

  it("resolves repository, global, then default Agent Profile selection", () => {
    const root = createTestWorkspace();
    const profiles = {
      repo: { ...profile, agentModel: "repo-model" },
      global: { ...profile, agentModel: "global-model" },
      default: { ...profile, agentModel: "default-model" },
    } satisfies NonNullable<GlobalConfig["agentProfiles"]>;
    const baseGlobal = {
      defaultAgentProfile: "default",
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
          taskPrefix: "BY",
          review: { acceptance: { agentProfile: "repo" } },
          agentProfiles: { repo: profiles.repo },
        },
        { ...baseGlobal, review: { acceptance: { agentProfile: "global" } } },
      ),
    ).toMatchObject({
      ok: true,
      policy: { agentProfile: "repo", profile: { agentModel: "repo-model" } },
    });
    expect(
      resolve(
        { taskPrefix: "BY" },
        { ...baseGlobal, review: { acceptance: { agentProfile: "global" } } },
      ),
    ).toMatchObject({
      ok: true,
      policy: { agentProfile: "global", profile: { agentModel: "global-model" } },
    });
    expect(resolve({ taskPrefix: "BY" }, baseGlobal)).toMatchObject({
      ok: true,
      policy: { agentProfile: "default", profile: { agentModel: "default-model" } },
    });
  });
});
