import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import {
  candidateReviewerOutputInstructions,
  completeCandidateReviewInstructions,
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

const specialistAcceptanceContextInstructions = [
  "When Acceptance Context is supplied, use it only to constrain Findings and required corrections.",
  "Do not expand or contradict approved intent.",
  "Do not require behavior that the Acceptance Context excludes.",
  "Respect explicit verification constraints in the Acceptance Context.",
  "Do not invent required verification mechanisms or demand evidence beyond what is necessary to judge approved intent.",
].join("\n");

const acceptanceContextEvidence = (context: unknown): string =>
  ["Acceptance Context:", encodeReviewerWireValue(context)].join("\n");

export const buildSpecialistReviewerSystemPrompt = (input: {
  readonly specialist: string;
  readonly instructions: string;
}): string =>
  [
    reviewerExecutionInstructions,
    completeCandidateReviewInstructions,
    `Configured concern: ${input.specialist}`,
    input.instructions,
    universalSpecialistInstructions,
    specialistAcceptanceContextInstructions,
    candidateReviewerOutputInstructions,
  ].join("\n\n");

export const buildSpecialistReviewerPrompt = (input: {
  readonly specialist: string;
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
    `Configured concern: ${input.specialist}`,
    ...(input.acceptanceContext === undefined
      ? []
      : ["", acceptanceContextEvidence(input.acceptanceContext)]),
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
  ].join("\n");

export const buildSpecialistContinuationPrompt = (input: {
  readonly specialist: string;
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
    `Continue this Specialist Reviewer Session for the configured concern: ${input.specialist}.`,
    ...(input.acceptanceContext === undefined
      ? []
      : ["", acceptanceContextEvidence(input.acceptanceContext)]),
    "Available Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    previousFindingsPrompt(input.previousFindings),
  ].join("\n");
