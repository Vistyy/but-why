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
        defaultAgentProfile: "default",
        agentProfiles: {
          default: { agentRuntime: "pi", agentModel: "default-model" },
          acceptance: { agentRuntime: "pi", agentModel: "acceptance-model" },
          specialist: { agentRuntime: "pi", agentModel: "specialist-model" },
        },
      }),
    );

    const decoded = decodeRepoConfig({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: {
        acceptance: { agentProfile: "acceptance" },
        specialists: ["security"],
      },
      reviewers: {
        security: {
          agentProfile: "specialist",
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
          acceptanceReview: { profile: { agentModel: "acceptance-model" } },
          specialistReviews: [{ id: "security", profile: { agentModel: "specialist-model" } }],
        },
      },
    });
  });
});
