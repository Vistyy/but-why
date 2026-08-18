import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { resolveCandidateValidationPolicy } from "../../src/change/candidateValidation/resolveCandidateValidationPolicy.js";
import { validateChangeReviewerConfigurationResources } from "../../src/change/changeReviewerConfiguration.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig } from "../../src/contracts/repoConfig.js";
import { readGlobalConfig } from "../../src/init/adapters/globalConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Candidate validation policy configuration", () => {
  it("defers reviewer resource validation until the effective Change configuration is selected", () => {
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
      idPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: { acceptance: { agentProfile: { scope: "global", name: "acceptance" } } },
    });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);

    const result = resolveCandidateValidationPolicy({
      context: {
        root,
        mainCheckoutRoot: root,
        commonDirectory: root,
        idPrefix: "BY",
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
        reviewerConfiguration: {
          acceptanceReview: {
            profile: { profile: { runtimeConfig: { skills: ["skills/missing"] } } },
          },
        },
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(
      validateChangeReviewerConfigurationResources(result.resolved.reviewerConfiguration, root),
    ).toMatchObject({
      ok: false,
      message: `Agent Profile "acceptance" in global scope has a missing skill resource at resolved path "${join(root, "skills/missing")}".`,
    });
  });

  it("uses the frozen Change reviewer configuration without reading current Global Config", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(globalConfigPath, "malformed");
    const decoded = decodeRepoConfig({
      idPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: { specialists: ["removed-reviewer"] },
    });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);

    const result = resolveCandidateValidationPolicy({
      context: { root, config: decoded.right },
      globalConfigPath,
      acceptanceContextSupplied: false,
      repoConfig: decoded.right,
      reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: { reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] } },
    });
  });

  it("resolves the complete Validation Policy from the Change Base Repo Config", () => {
    const root = createTestWorkspace();
    const globalConfigPath = join(root, "global-config.json");
    writeFileSync(globalConfigPath, "{}");
    const changeBase = decodeRepoConfig({
      idPrefix: "BY",
      agentEnvironment: { command: ["trusted-environment"] },
      prepare: { command: "base-prepare" },
      validation: { checks: [{ id: "base", command: "true" }] },
      snapshotWorkspace: { copyFiles: ["trusted-file"] },
    });
    if (Either.isLeft(changeBase)) throw new Error("Repo Config fixture is invalid.");

    const result = resolveCandidateValidationPolicy({
      context: { root, config: changeBase.right },
      globalConfigPath,
      globalConfig: globalConfigAt(globalConfigPath),
      acceptanceContextSupplied: false,
      repoConfig: changeBase.right,
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: {
        acceptanceContextSupplied: false,
        policy: {
          agentEnvironment: ["trusted-environment"],
          prepare: { command: "base-prepare" },
          checks: [{ id: "base", command: "true" }],
          copyFiles: ["trusted-file"],
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
      idPrefix: "BY",
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
        idPrefix: "BY",
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
        },
        reviewerConfiguration: {
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
