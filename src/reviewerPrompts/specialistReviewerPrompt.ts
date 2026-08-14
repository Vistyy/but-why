import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import {
  currentCandidateReReviewInstructions,
  previousFindingsPrompt,
  reviewerExecutionInstructions,
} from "./reviewerPromptSupport.js";

const universalSpecialistInstructions = [
  "Review the exact Candidate only for the configured concern.",
  "Limit investigation to evidence necessary to judge that concern.",
  "Report only material Findings that belong to that concern.",
  "For each Finding, identify why the problem and required correction belong to the configured concern.",
  "Do not broaden the configured concern into a general review.",
  "Do not investigate or report adjacent concerns.",
  "Do not require optional improvement.",
  "If judging the configured concern would require expansion into another concern, stop rather than report that adjacent concern.",
  "Return an empty Findings array when the configured concern has no material Finding.",
  "Treat configured Specialist instructions as the definition of concern-specific scope, subordinate to these common constraints.",
].join("\n");

const acceptanceContextConstraint = (context: unknown): string =>
  [
    "Immutable Acceptance Context (authoritative scope constraint):",
    encodeReviewerWireValue(context),
    "Use this context only to constrain Findings and required corrections.",
    "Do not expand or contradict approved intent.",
    "Do not require behavior that the context excludes.",
    "Respect explicit verification constraints in the context.",
    "Do not invent required verification mechanisms or demand evidence beyond what is necessary to judge approved intent.",
  ].join("\n");

export const buildSpecialistReviewerPrompt = (input: {
  readonly specialist: string;
  readonly instructions: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly previousFindings?: readonly unknown[];
  readonly acceptanceContext?: unknown;
}): string =>
  [
    input.instructions,
    universalSpecialistInstructions,
    reviewerExecutionInstructions,
    "",
    `Configured concern: ${input.specialist}`,
    "Inspect the repository and Candidate diff before deciding.",
    ...(input.acceptanceContext === undefined
      ? []
      : ["", acceptanceContextConstraint(input.acceptanceContext)]),
    "",
    "Available Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "",
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    ...(input.previousFindings === undefined || input.previousFindings.length === 0
      ? []
      : [previousFindingsPrompt(input.previousFindings)]),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must contain title, description, evidence, files, and artifactRefs.",
  ].join("\n");

export const buildSpecialistContinuationPrompt = (input: {
  readonly specialist: string;
  readonly instructions: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly previousFindings: readonly unknown[];
  readonly acceptanceContext?: unknown;
}): string =>
  [
    input.instructions,
    universalSpecialistInstructions,
    reviewerExecutionInstructions,
    "",
    `Configured concern: ${input.specialist}`,
    "Continue this Specialist Reviewer Session for the configured concern.",
    currentCandidateReReviewInstructions,
    ...(input.acceptanceContext === undefined
      ? []
      : ["", acceptanceContextConstraint(input.acceptanceContext)]),
    "Available Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    previousFindingsPrompt(input.previousFindings),
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must contain title, description, evidence, files, and artifactRefs.",
  ].join("\n");
