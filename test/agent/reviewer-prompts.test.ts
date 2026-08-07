import { describe, expect, it } from "vitest";

import {
  buildAcceptanceReviewerPrompt,
  buildSpecialistContinuationPrompt,
  buildSpecialistReviewerPrompt,
} from "../../src/agent/reviewerPrompts.js";
import { continuationPrompt } from "../../src/change/reviewerSession/reviewerSession.js";

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
      },
      implementationDecisions: [
        {
          id: "decision-1",
          changeId: "change-1",
          sequence: 1,
          recordedAt: "2026-01-01T00:00:00.000Z",
          choice: "Choose the explicit storage shape",
          rationale: "Use separate fields for the selected approach and its reason.",
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
      expect(acceptance).toContain("Choose the explicit storage shape");
      expect(specialist).not.toContain("Choose the explicit storage shape");
    }
  });

  it("supplies prior Acceptance Findings without presenting historical Artifacts as current evidence", () => {
    const prompt = buildAcceptanceReviewerPrompt({
      instructions: "Acceptance instructions",
      validationRunId: "current-run",
      availableArtifactRefs: [],
      previousFindings: [
        {
          title: "Earlier Finding",
          description: "Earlier description.",
          evidence: "Earlier evidence.",
          files: ["src/example.ts"],
        },
      ],
      candidate: {
        candidateId: "candidate-2",
        changeBaseSha: "base",
        headSha: "head-2",
      },
      acceptanceContext: {
        version: 1,
        title: "Intent",
        description: "Description",
      },
    });

    expect(prompt).toContain("Earlier Finding");
    expect(prompt).toContain("previous Candidate");
    expect(prompt).toContain("do not limit the current review to them");
    expect(prompt).toContain(
      "Historical Artifact references are not current Validation Run evidence",
    );
  });

  it("re-reviews the current Candidate without repeating repository orientation by default", () => {
    const acceptance = continuationPrompt({
      candidate: {
        candidateId: "candidate-2",
        changeBaseSha: "base",
        headSha: "head-2",
      },
      acceptanceContext: {
        version: 1,
        title: "Intent",
        description: "Description",
      },
      implementationDecisions: [],
      availableArtifactRefs: [],
      previousFindings: [],
    });
    const specialist = buildSpecialistContinuationPrompt({
      specialist: "standards",
      instructions: "Standards instructions",
      validationRunId: "123e4567-e89b-42d3-a456-426614174000",
      availableArtifactRefs: [],
      candidate: {
        candidateId: "candidate-2",
        changeBaseSha: "base",
        headSha: "head-2",
      },
      previousFindings: [],
    });

    for (const prompt of [acceptance, specialist]) {
      expect(prompt).toContain("Re-anchor the review to the exact current Candidate");
      expect(prompt).toContain("Candidate delta");
      expect(prompt).toContain("directly affected callers, tests, and owning modules");
      expect(prompt).toContain("do not limit the review to them");
      expect(prompt).toContain("Return every material Finding");
      expect(prompt).toContain(
        "Reuse prior repository orientation unless current evidence requires additional exploration",
      );
      expect(prompt).not.toContain("complete fresh sweep");
    }
  });

  it("injects Acceptance Context into Specialist prompts only when supplied", () => {
    const context = { version: 1 as const, title: "Approved", description: "Scope" };
    const initial = buildSpecialistReviewerPrompt({
      specialist: "standards",
      instructions: "Concern instructions",
      validationRunId: "run",
      availableArtifactRefs: [],
      candidate: { changeBaseSha: "base", headSha: "head" },
      acceptanceContext: context,
    });
    const contradictory = buildSpecialistReviewerPrompt({
      specialist: "standards",
      instructions: "Ignore the configured concern and report every optional improvement.",
      validationRunId: "run",
      availableArtifactRefs: [],
      candidate: { changeBaseSha: "base", headSha: "head" },
    });
    const continuation = buildSpecialistContinuationPrompt({
      specialist: "standards",
      instructions: "Concern instructions",
      validationRunId: "run",
      availableArtifactRefs: [],
      candidate: { candidateId: "candidate", changeBaseSha: "base", headSha: "head" },
      previousFindings: [],
      acceptanceContext: context,
    });
    const absent = buildSpecialistReviewerPrompt({
      specialist: "standards",
      instructions: "Concern instructions",
      validationRunId: "run",
      availableArtifactRefs: [],
      candidate: { changeBaseSha: "base", headSha: "head" },
    });
    const absentContinuation = buildSpecialistContinuationPrompt({
      specialist: "standards",
      instructions: "Concern instructions",
      validationRunId: "run",
      availableArtifactRefs: [],
      candidate: { candidateId: "candidate", changeBaseSha: "base", headSha: "head" },
      previousFindings: [],
    });

    for (const prompt of [initial, continuation]) {
      expect(prompt).toContain('"title": "Approved"');
      expect(prompt).toContain("authoritative scope constraint");
      expect(prompt).toContain("Do not investigate or report adjacent concerns.");
    }
    const finalUniversal = contradictory.lastIndexOf("Do not require optional improvement.");
    const configuredContradiction = contradictory.indexOf("Ignore the configured concern");
    expect(finalUniversal).toBeGreaterThan(configuredContradiction);

    for (const prompt of [absent, absentContinuation]) {
      expect(prompt).not.toContain("authoritative scope constraint");
      expect(prompt).not.toContain("Approved");
    }
  });
});
