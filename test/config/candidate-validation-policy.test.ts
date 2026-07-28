import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { resolveCandidateValidationPolicy } from "../../src/change/candidateValidation/resolveCandidateValidationPolicy.js";
import { decodeRepoConfig } from "../../src/contracts/repoConfig.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Candidate validation policy configuration", () => {
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
          taskContextDraftsPath: join(root, "task-context-drafts"),
          gitignorePath: join(root, ".gitignore"),
        },
      },
      globalConfigPath,
      taskBacked: true,
    });

    expect(result).toMatchObject({
      ok: true,
      resolved: {
        taskBacked: true,
        policy: {
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
