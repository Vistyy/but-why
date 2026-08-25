import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import { reviewerExecutionInstructions } from "./reviewerPromptSupport.js";

export const taskSimplificationAdviceBuiltInInstructions = [
  "TASK SIMPLIFICATION ADVICE",
  "Identify the practical core outcome of the exact Task Review Proposal.",
  "Make one underengineer attempt. The advice is non-authoritative: do not add requirements, create Findings, change the Task Review outcome, approve the Task, or prevent a valid New-to-Todo transition.",
  "Offer zero, one, or two safe subtractive scope cuts or subtractive integrations.",
  "For every option state the retained outcome, removed complexity, lost behavior, credible adverse consequence, repository evidence, and material uncertainty.",
  "If no substantial safe simplification is supported, return no options and explain why.",
  "Use only the exact proposal, captured dependency evidence, Review Base, and repository evidence supplied by the review workspace.",
  "Do not propose additive scope, custom guidance, retries, or a different Task outcome.",
].join("\n");

export const buildTaskSimplificationAdviceSystemPrompt = (builtInInstructions: string): string =>
  [
    reviewerExecutionInstructions,
    builtInInstructions,
    `Return only one JSON object inside <${reviewerOutputTag}> with exactly practicalCoreOutcome, options, and noSafeSimplificationReason.`,
    "Use noSafeSimplificationReason as null when options are present, and a non-blank explanation when options is empty.",
  ].join("\n\n");

export const buildTaskSimplificationAdviceOutputCorrectionPrompt = (failure: {
  readonly message: string;
}): string =>
  [
    "Your Underengineer output did not satisfy the required Task Simplification Advice contract.",
    failure.message,
    `Return only one JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}> with exactly this complete form:`,
    '{"practicalCoreOutcome":"...","options":[],"noSafeSimplificationReason":"..."}',
    "options must contain zero, one, or two objects.",
    "Each option must contain exactly retainedOutcome, removedComplexity, lostBehavior, adverseConsequence, repositoryEvidence, and materialUncertainty.",
    "Use a non-blank noSafeSimplificationReason when options is empty, or null when options are present.",
  ].join("\n");

export const buildTaskSimplificationAdvicePrompt = (input: {
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
  readonly reviewBase: { readonly ref: string; readonly commit: string };
}): string =>
  [
    "Exact Task Review Proposal:",
    JSON.stringify(input.proposal),
    "",
    "Captured Task Dependency evidence:",
    JSON.stringify({ dependencies: input.dependencyEvidence }),
    "",
    "Review Base:",
    JSON.stringify(input.reviewBase),
  ].join("\n");
