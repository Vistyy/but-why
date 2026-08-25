import { describe, expect, it } from "vitest";
import {
  buildAcceptanceReviewerSystemPrompt,
  defaultAcceptanceInstructions,
} from "../../src/reviewerPrompts/acceptanceReviewerPrompt.js";
import { buildSpecialistReviewerSystemPrompt } from "../../src/reviewerPrompts/specialistReviewerPrompt.js";
import { buildTaskReviewerSystemPrompt } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { buildTaskSimplificationAdviceSystemPrompt } from "../../src/reviewerPrompts/taskSimplificationAdvicePrompt.js";

const experimentInstruction =
  "design and perform a bounded real-system experiment within the stated permitted-effects boundary";

const expectExperimentGuidance = (prompt: string): void => {
  expect(prompt).toContain(experimentInstruction);
  expect(prompt).toContain("an integration prototype tests whether several parts work together");
  expect(prompt).toContain(
    "testing components separately does not establish that they work together",
  );
  expect(prompt).toContain("Stop experimenting when the evidence supports the assigned judgment");
};

describe("reviewer experiment guidance", () => {
  it("gives Task Reviewers bounded experiment authority before escalation", () => {
    const prompt = buildTaskReviewerSystemPrompt({
      builtInInstructions: "Task review policy.",
      guidance: null,
    });

    expectExperimentGuidance(prompt);
    expect(prompt).toContain("exact Review Base workspace");
    expect(prompt).toContain("Do not mutate live Shared Repository State");
  });

  it("gives Acceptance Reviewers bounded experiment authority", () => {
    const prompt = buildAcceptanceReviewerSystemPrompt(defaultAcceptanceInstructions);

    expectExperimentGuidance(prompt);
    expect(prompt).toContain("exact Candidate's Snapshot Workspace");
    expect(prompt).toContain("Do not mutate live Shared Repository State");
  });

  it("gives Specialist Reviewers bounded experiment authority", () => {
    const prompt = buildSpecialistReviewerSystemPrompt({
      specialist: "standards",
      instructions: "Judge the standards concern.",
    });

    expectExperimentGuidance(prompt);
    expect(prompt).toContain("exact Candidate's Snapshot Workspace");
    expect(prompt).toContain("Do not mutate live Shared Repository State");
  });

  it("does not broaden Task Simplification Advice with experiment duties", () => {
    expect(buildTaskSimplificationAdviceSystemPrompt("Simplify the Task.")).not.toContain(
      experimentInstruction,
    );
  });
});
