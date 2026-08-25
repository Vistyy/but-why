import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import { reviewerExecutionInstructions } from "./reviewerPromptSupport.js";

export const taskSimplificationAdviceBuiltInInstructions = [
  "TASK SIMPLIFICATION ADVICE",
  "Recommend the best supported safe simplification of the exact Task Review Proposal, or explain why no safe simplification is supported.",
  "The advice is non-authoritative: do not add requirements, create Findings, change the Task Review outcome, approve the Task, or prevent a valid New-to-Todo transition.",
  "Make the complete advice understandable by explaining what would be removed and why the retained result remains sufficient, including material trade-offs or uncertainty.",
  "Use one nonblank Markdown block as the complete Advice. Do not require separate titles, options, evidence fields, semantic headings, or parsed properties.",
  "Use only the exact proposal, captured dependency evidence, Review Base, and repository evidence supplied by the review workspace.",
  "Do not propose additive scope, custom guidance, retries, or a different Task outcome.",
].join("\n");

export const buildTaskSimplificationAdviceSystemPrompt = (builtInInstructions: string): string =>
  [
    reviewerExecutionInstructions,
    builtInInstructions,
    `Return exactly one nonblank Markdown block inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
    `<${reviewerOutputTag}>`,
    "Your complete Markdown Advice.",
    `</${reviewerOutputTag}>`,
  ].join("\n\n");

export const buildTaskSimplificationAdviceOutputCorrectionPrompt = (failure: {
  readonly message: string;
}): string =>
  [
    "Your Underengineer output did not satisfy the required nonblank Markdown Task Simplification Advice contract.",
    failure.message,
    `Return exactly one nonblank Markdown block inside <${reviewerOutputTag}>...</${reviewerOutputTag}> in this complete form:`,
    `<${reviewerOutputTag}>`,
    "Your complete Markdown Advice.",
    `</${reviewerOutputTag}>`,
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
