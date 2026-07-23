import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSpecialistReviewPolicies } from "../../src/change/specialistReview/specialistReviewConfig.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const piProfile = (agentModel: string) => ({
  agentRuntime: "pi" as const,
  agentModel,
  thinking: "high" as const,
});

describe("Specialist Review configuration", () => {
  it("uses the Repo active list and definitions before Global Config", () => {
    const root = configRoot();
    writeFileSync(join(root.repo, "repo-security.md"), "Repo security instructions\n");
    writeFileSync(join(root.global, "global-security.md"), "Global security instructions\n");
    writeFileSync(join(root.global, "standards.md"), "Global standards instructions\n");

    const repoConfig = {
      taskPrefix: "BY",
      review: { specialists: ["security"] },
      reviewers: {
        security: { instructionsFile: "repo-security.md", agentProfile: "review" },
      },
      agentProfiles: { review: piProfile("repo-model") },
    } satisfies RepoConfig;
    const globalConfig = {
      review: { specialists: ["standards"] },
      reviewers: {
        security: { instructionsFile: "global-security.md", agentProfile: "review" },
        standards: { instructionsFile: "standards.md" },
      },
      defaultAgentProfile: "default",
      agentProfiles: {
        review: piProfile("global-model"),
        default: piProfile("default-model"),
      },
    } satisfies GlobalConfig;

    expect(resolve(root, repoConfig, globalConfig)).toEqual({
      ok: true,
      policies: [
        {
          id: "security",
          instructions: "Repo security instructions\n",
          instructionsSource: "repo",
          agentProfile: "review",
          profileSource: "repo",
          profile: piProfile("repo-model"),
        },
      ],
    });
  });

  it("uses the Global active list and default profile when Repo Config omits the list", () => {
    const root = configRoot();
    writeFileSync(join(root.global, "standards.md"), "Standards instructions\n");

    expect(
      resolve(
        root,
        { taskPrefix: "BY" },
        {
          review: { specialists: ["standards"] },
          reviewers: { standards: { instructionsFile: "standards.md" } },
          defaultAgentProfile: "default",
          agentProfiles: { default: piProfile("default-model") },
        },
      ),
    ).toMatchObject({
      ok: true,
      policies: [
        {
          id: "standards",
          instructionsSource: "global",
          agentProfile: "default",
          profileSource: "global",
          profile: { agentModel: "default-model" },
        },
      ],
    });
  });

  it("accepts an empty Repo list and rejects duplicate or unresolved Specialists", () => {
    const root = configRoot();
    const globalConfig = {
      review: { specialists: ["standards"] },
      reviewers: { standards: { instructionsFile: "standards.md" } },
    } satisfies GlobalConfig;

    expect(resolve(root, { taskPrefix: "BY", review: { specialists: [] } }, globalConfig)).toEqual({
      ok: true,
      policies: [],
    });
    expect(
      resolve(root, { taskPrefix: "BY", review: { specialists: ["missing"] } }, {}),
    ).toMatchObject({
      ok: false,
      error: { _tag: "InvalidReviewerConfig", message: "Specialist is not defined: missing" },
    });
    const duplicate = resolve(
      root,
      { taskPrefix: "BY", review: { specialists: ["same", "same"] } },
      {},
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { _tag: "InvalidReviewerConfig" },
    });
    if (!duplicate.ok) expect(duplicate.error.message).toBe("Duplicate Specialist: same");
  });
});

const configRoot = () => {
  const root = createTestWorkspace();
  const repo = join(root, "repo");
  const global = join(root, "global");
  mkdirSync(repo, { recursive: true });
  mkdirSync(global, { recursive: true });
  return { repo, global, globalConfigPath: join(global, "config.json") };
};

const resolve = (
  root: ReturnType<typeof configRoot>,
  repoConfig: RepoConfig,
  globalConfig: GlobalConfig,
) =>
  resolveSpecialistReviewPolicies({
    repoConfig,
    globalConfig,
    repoRoot: root.repo,
    globalConfigPath: root.globalConfigPath,
  });
