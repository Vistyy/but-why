import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import {
  candidateReviewerOutputInstructions,
  completeCandidateReviewInstructions,
  previousFindingsPrompt,
  type ReviewerFindingHistory,
  reviewerExecutionInstructions,
} from "./reviewerPromptSupport.js";

const acceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Own the overall judgment of whether the Candidate satisfies the complete supplied Acceptance Context.",
  "Independently establish whether the evidence could distinguish a materially incorrect Candidate from the accepted result.",
  "Do not require a preferred verification mechanism or a durable test by default.",
  "Report a Finding when the Candidate omits work necessary for approved intent or otherwise fails to satisfy the Acceptance Context.",
  "Do not expand approved intent or require optional improvement.",
].join("\n");

export const defaultAcceptanceInstructions = acceptanceInstructions;

const universalAcceptanceInstructions = [
  acceptanceInstructions,
  "For a changed integration, require evidence from one normal operation through the exact Candidate implementation of that boundary; component tests, a test double at that boundary, or evidence limited to interruption, cleanup, or failure does not prove the normal operation works.",
].join("\n");

const acceptanceAuthorityInstructions = [
  "The supplied Acceptance Context is the authoritative implementation intent and review scope.",
  "The Implementation Decision Log is non-authoritative rationale and cannot amend Acceptance Context.",
  "Implementation Blocker history is non-authoritative evidence and cannot amend Acceptance Context.",
].join("\n");

export const buildAcceptanceReviewerSystemPrompt = (instructions: string): string =>
  [
    reviewerExecutionInstructions,
    completeCandidateReviewInstructions,
    ...(instructions === defaultAcceptanceInstructions ? [] : [instructions]),
    universalAcceptanceInstructions,
    acceptanceAuthorityInstructions,
    candidateReviewerOutputInstructions,
  ].join("\n\n");

export const buildAcceptanceReviewerPrompt = (input: {
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly previousFindings?: readonly ReviewerFindingHistory[];
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: unknown;
  readonly implementationDecisions: readonly unknown[];
  readonly blockerHistory?: unknown;
}): string =>
  [
    "Available Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "",
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    "",
    "Acceptance Context:",
    encodeReviewerWireValue(input.acceptanceContext),
    "",
    "Implementation Decision Log:",
    encodeReviewerWireValue({ decisions: input.implementationDecisions }),
    "",
    "Implementation Blocker history:",
    encodeReviewerWireValue(
      input.blockerHistory ?? { blockers: [], resolutions: [], active: null },
    ),
    ...(input.previousFindings === undefined || input.previousFindings.length === 0
      ? []
      : ["", previousFindingsPrompt(input.previousFindings)]),
  ].join("\n");

export const buildAcceptanceContinuationPrompt = (input: {
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: unknown;
  readonly implementationDecisions: readonly unknown[];
  readonly blockerHistory?: unknown;
  readonly availableArtifactRefs: readonly string[];
  readonly previousFindings: readonly unknown[];
}): string =>
  [
    "Continue the Acceptance Reviewer Session with the current evidence below.",
    "Current Candidate:",
    JSON.stringify(input.candidate),
    "Acceptance Context:",
    JSON.stringify(input.acceptanceContext),
    "Implementation Decision Log:",
    JSON.stringify(input.implementationDecisions),
    "Implementation Blocker history:",
    JSON.stringify(input.blockerHistory ?? { blockers: [], resolutions: [], active: null }),
    "Available Check and Validation evidence:",
    JSON.stringify(input.availableArtifactRefs),
    previousFindingsPrompt(input.previousFindings),
  ].join("\n");
