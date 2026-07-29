import { describe, expect, it } from "vitest";

import {
  buildAcceptanceReviewerPrompt,
  buildSpecialistReviewerPrompt,
} from "../../src/agent/reviewerPrompts.js";

describe("reviewer prompts", () => {
  it("allows targeted scratch experiments and reuses broad Check Artifacts", () => {
    const acceptance = buildAcceptanceReviewerPrompt({
      instructions: "Acceptance instructions",
      validationRunId: "123e4567-e89b-42d3-a456-426614174000",
      availableArtifactRefs: [],
      candidate: {
        candidateId: "candidate-1",
        changeBaseSha: "base",
        headSha: "head",
      },
      acceptanceContext: {
        version: 1,
        title: "Intent",
        description: "Description",
        comments: [],
      },
      implementationDecisions: [
        {
          id: "decision-1",
          changeId: "change-1",
          sequence: 1,
          recordedAt: "2026-01-01T00:00:00.000Z",
          content: "Choose the explicit storage shape.",
        },
      ],
    });
    const specialist = buildSpecialistReviewerPrompt({
      specialist: "security",
      instructions: "Specialist instructions",
      validationRunId: "123e4567-e89b-42d3-a456-426614174000",
      availableArtifactRefs: ["artifact:check"],
      candidate: { changeBaseSha: "base", headSha: "head" },
    });

    for (const prompt of [acceptance, specialist]) {
      expect(prompt).toContain("targeted experiments");
      expect(prompt).toContain("Check Artifacts");
      expect(prompt).toContain("must not modify the Candidate");
      expect(prompt).toContain("operating-system temporary space");
      expect(acceptance).toContain("non-authoritative rationale");
      expect(acceptance).toContain("Choose the explicit storage shape.");
      expect(specialist).not.toContain("Choose the explicit storage shape.");
    }
  });
});
