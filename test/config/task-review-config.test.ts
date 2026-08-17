import { describe, expect, it } from "vitest";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveTaskReviewPolicy } from "../../src/task/review/taskReviewConfig.js";

const profile = (model: string, skills?: readonly string[]) => ({
  agentRuntime: "pi" as const,
  runtimeConfig: { model, ...(skills === undefined ? {} : { skills }) },
});

const resolve = (repoConfig: RepoConfig, globalConfig: GlobalConfig) =>
  resolveTaskReviewPolicy({
    repoConfig,
    globalConfig,
    globalConfigPath: "/global/config.json",
    builtInInstructions: "Mandatory core",
    readRepoGuidance: (path) => ({ ok: true, content: `repo:${path}` }),
    readGlobalGuidance: (path) => ({ ok: true, content: `global:${path}` }),
    repoResourceExists: (path) => path === "skills/task",
  });

describe("Task Review configuration", () => {
  it("resolves Repo, Global, then default Agent Profile selection and captures its configuration", () => {
    const globalConfig = {
      defaultAgentProfile: { scope: "global", name: "default" },
      agentProfiles: {
        global: profile("global-model"),
        default: profile("default-model"),
      },
      review: { task: { agentProfile: { scope: "global", name: "global" } } },
    } satisfies GlobalConfig;

    expect(
      resolve(
        {
          idPrefix: "BY",
          review: { task: { agentProfile: { scope: "repo", name: "repo" } } },
          agentProfiles: { repo: profile("repo-model", ["skills/task"]) },
        },
        globalConfig,
      ),
    ).toMatchObject({
      ok: true,
      policy: {
        profile: { agentProfile: "repo", scope: "repo" },
        snapshot: {
          profile: {
            agentProfile: "repo",
            scope: "repo",
            profile: { runtimeConfig: { model: "repo-model", skills: ["skills/task"] } },
          },
        },
      },
    });
    expect(resolve({ idPrefix: "BY" }, globalConfig)).toMatchObject({
      ok: true,
      policy: { snapshot: { profile: { agentProfile: "global", scope: "global" } } },
    });
    expect(
      resolve(
        { idPrefix: "BY" },
        {
          defaultAgentProfile: globalConfig.defaultAgentProfile,
          agentProfiles: globalConfig.agentProfiles,
        },
      ),
    ).toMatchObject({
      ok: true,
      policy: { snapshot: { profile: { agentProfile: "default", scope: "global" } } },
    });
  });

  it("selects at most one Repo-first guidance file and keeps the mandatory core separate", () => {
    const result = resolve(
      {
        idPrefix: "BY",
        review: { task: { instructionsFile: "review/task.md" } },
      },
      {
        defaultAgentProfile: { scope: "global", name: "default" },
        agentProfiles: { default: profile("default-model") },
        review: { task: { instructionsFile: "review/global-task.md" } },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      policy: {
        snapshot: {
          builtInInstructions: "Mandatory core",
          guidance: { content: "repo:review/task.md", source: "repo" },
        },
      },
    });
  });

  it("rejects missing Review Base resources before policy capture", () => {
    expect(
      resolve(
        {
          idPrefix: "BY",
          review: { task: { agentProfile: { scope: "repo", name: "repo" } } },
          agentProfiles: { repo: profile("repo-model", ["skills/missing"]) },
        },
        {},
      ),
    ).toEqual({
      ok: false,
      message:
        'Agent Profile "repo" in repo scope has a missing skill resource at Review Base path "skills/missing".',
    });
  });
});
