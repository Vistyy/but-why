import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import {
  candidateReviewerExperimentAuthorityInstructions,
  candidateReviewerExperimentBoundaryInstructions,
  candidateReviewerOutputInstructions,
  completeCandidateReviewInstructions,
  previousFindingsPrompt,
  reviewerExecutionInstructions,
  reviewerExperimentInstructions,
} from "./reviewerPromptSupport.js";

const universalSpecialistInstructions = [
  "Attack the exact Candidate only through the configured concern and try to falsify every material claim that belongs to it.",
  "Treat the configured concern as a complete adversarial responsibility, not as a checklist to sample until no obvious defect appears.",
  "Limit investigation to evidence necessary to judge that concern, but follow a defect through directly affected code, tests, authorities, and runtime paths when that evidence remains inside the concern.",
  "Report every material Finding that belongs to the concern and continue searching after the first Finding for sibling defects and shared causes.",
  "For each Finding, identify why the problem, evidence, and smallest sufficient correction belong to the configured concern.",
  "Challenge the necessity of a defective mechanism before asking the author to add recovery, abstraction, validation, or tests around it.",
  "Do not accept a local patch as proof that the containing design is sound.",
  "Do not broaden the configured concern into a general review.",
  "Do not investigate or report adjacent concerns.",
  "Do not require optional improvement.",
  "If judging the configured concern would require expansion into another concern, stop rather than report that adjacent concern.",
  "Return an empty Findings array only after adversarial investigation finds no material defect in the configured concern.",
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
    candidateReviewerExperimentBoundaryInstructions,
    reviewerExperimentInstructions,
    completeCandidateReviewInstructions,
    `Configured concern: ${input.specialist}`,
    input.instructions,
    candidateReviewerExperimentAuthorityInstructions,
    universalSpecialistInstructions,
    specialistAcceptanceContextInstructions,
    candidateReviewerOutputInstructions,
  ].join("\n\n");

export const buildSpecialistReviewerPrompt = (input: {
  readonly specialist: string;
  readonly validationRunId: number;
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
  readonly validationRunId: number;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly candidateId: number;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly previousFindings: readonly unknown[];
  readonly acceptanceContext?: unknown;
}): string =>
  [
    `Continue this Specialist Agent Session for the configured concern: ${input.specialist}.`,
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
