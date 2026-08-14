import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { resolveCandidateValidationPolicy } from "../../src/change/candidateValidation/resolveCandidateValidationPolicy.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig } from "../../src/contracts/repoConfig.js";
import { readGlobalConfig } from "../../src/init/adapters/globalConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Candidate validation policy configuration", () => {
  it("rejects missing reviewer resources before resolving a Validation Run policy", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        agentProfiles: {
          acceptance: {
            agentRuntime: "pi",
            runtimeConfig: { model: "acceptance-model", skills: ["skills/missing"] },
          },
        },
      }),
    );
    const decoded = decodeRepoConfig({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: { acceptance: { agentProfile: { scope: "global", name: "acceptance" } } },
    });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);

    const result = resolveCandidateValidationPolicy({
      context: {
        root,
        mainCheckoutRoot: root,
        commonDirectory: root,
        taskPrefix: "BY",
        config: decoded.right,
        paths: {
          butWhyDir: join(root, ".but-why"),
          operationalDir: join(root, "operational"),
          configPath: join(root, ".but-why", "config.json"),
          statePath: join(root, "state.sqlite"),
          reviewersPath: join(root, ".but-why", "reviewers"),
          artifactsPath: join(root, "artifacts"),
          snapshotsPath: join(root, "snapshots"),
          taskContextDraftsPath: join(root, "task-context-drafts"),
        },
      },
      globalConfigPath,
      globalConfig: globalConfigAt(globalConfigPath),
      acceptanceContextSupplied: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "MissingAgentProfileResource",
        profileName: "acceptance",
        scope: "global",
        resourceType: "skill",
        path: join(root, "skills/missing"),
        message: `Agent Profile "acceptance" in global scope has a missing skill resource at resolved path "${join(root, "skills/missing")}".`,
      },
    });
  });

  it("uses the frozen Change reviewer configuration without resolving current reviewer selections", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(globalConfigPath, "{}");
    const decoded = decodeRepoConfig({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: { specialists: ["removed-reviewer"] },
    });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);

    const result = resolveCandidateValidationPolicy({
      context: { root, config: decoded.right },
      globalConfigPath,
      globalConfig: globalConfigAt(globalConfigPath),
      acceptanceContextSupplied: false,
      repoConfig: decoded.right,
      reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: { policy: { specialistReviews: [] } },
    });
  });

  it("resolves Repository Preparation from the Change Base Repo Config", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(globalConfigPath, "{}");
    const candidate = decodeRepoConfig({
      taskPrefix: "BY",
      prepare: { command: "candidate-prepare" },
      validation: { checks: [{ id: "candidate", command: "true" }] },
    });
    const changeBase = decodeRepoConfig({
      taskPrefix: "BY",
      prepare: { command: "base-prepare" },
      validation: { checks: [{ id: "base", command: "true" }] },
    });
    if (Either.isLeft(candidate) || Either.isLeft(changeBase))
      throw new Error("Repo Config fixture is invalid.");

    const result = resolveCandidateValidationPolicy({
      context: { root, config: candidate.right },
      globalConfigPath,
      globalConfig: globalConfigAt(globalConfigPath),
      acceptanceContextSupplied: false,
      repoConfig: candidate.right,
      validationRepoConfig: changeBase.right,
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: {
        acceptanceContextSupplied: false,
        policy: {
          prepare: { command: "base-prepare" },
          checks: [{ id: "base", command: "true" }],
        },
      },
    });
  });

  it("uses configured Acceptance and Specialist Review selections", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(join(root, "security.md"), "Review security.\n");
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "default" },
        agentProfiles: {
          default: { agentRuntime: "pi", runtimeConfig: { model: "default-model" } },
          acceptance: { agentRuntime: "pi", runtimeConfig: { model: "acceptance-model" } },
          specialist: { agentRuntime: "pi", runtimeConfig: { model: "specialist-model" } },
        },
      }),
    );

    const decoded = decodeRepoConfig({
      taskPrefix: "BY",
      agentEnvironment: { command: ["nix", "develop", "-c"] },
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: {
        acceptance: { agentProfile: { scope: "global", name: "acceptance" } },
        specialists: ["security"],
      },
      reviewers: {
        security: {
          agentProfile: { scope: "global", name: "specialist" },
          instructionsFile: "security.md",
        },
      },
    });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);

    const result = resolveCandidateValidationPolicy({
      context: {
        root,
        mainCheckoutRoot: root,
        commonDirectory: root,
        taskPrefix: "BY",
        config: decoded.right,
        paths: {
          butWhyDir: join(root, ".but-why"),
          operationalDir: join(root, "operational"),
          configPath: join(root, ".but-why", "config.json"),
          statePath: join(root, "state.sqlite"),
          reviewersPath: join(root, ".but-why", "reviewers"),
          artifactsPath: join(root, "artifacts"),
          snapshotsPath: join(root, "snapshots"),
          taskContextDraftsPath: join(root, "task-context-drafts"),
        },
      },
      globalConfigPath,
      globalConfig: globalConfigAt(globalConfigPath),
      acceptanceContextSupplied: true,
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: {
        acceptanceContextSupplied: true,
        policy: {
          agentEnvironment: ["nix", "develop", "-c"],
          acceptanceReview: {
            profile: { profile: { runtimeConfig: { model: "acceptance-model" } } },
          },
          specialistReviews: [
            {
              id: "security",
              profile: { profile: { runtimeConfig: { model: "specialist-model" } } },
            },
          ],
        },
      },
    });
  });
});

const globalConfigAt = (path: string): GlobalConfig => {
  const result = readGlobalConfig(path);
  if (!result.ok) throw result.error;
  return result.config;
};
