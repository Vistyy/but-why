import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";

export const taskReviewInstructions = [
  "Review one exact New Task proposal before Task Approval.",
  "Judge whether the proposal is coherent, implementable, and verifiable as one supported result in this repository.",
  "Treat the selected title, description, and direct Task Dependency identities as the proposal under review.",
  "Use dependency evidence only to understand the observed prerequisites. Later dependency changes cannot alter this review.",
  "Report a Finding for each material ambiguity, contradiction, unsupported outcome, unsafe boundary, missing prerequisite, or verification impossibility that should be resolved before Task Approval.",
  "Do not design the implementation, expand requested intent, require a preferred implementation, or require optional improvement.",
  "Return an empty Findings array when the exact proposal is safe to approve.",
].join("\n");

export const buildTaskReviewerPrompt = (input: {
  readonly proposal: {
    readonly title: string;
    readonly description: string;
    readonly dependencyIds: readonly string[];
  };
  readonly dependencyEvidence: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly state: string;
  }[];
}): string =>
  [
    taskReviewInstructions,
    "",
    "Exact Task proposal:",
    JSON.stringify(input.proposal),
    "",
    "Captured direct Task Dependency evidence:",
    JSON.stringify({ dependencies: input.dependencyEvidence }),
    "",
    "Inspect the repository at the exact Review Base before deciding.",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, files, and artifactRefs. artifactRefs must be empty.",
  ].join("\n");
