import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import {
  currentCandidateReReviewInstructions,
  previousFindingsPrompt,
  type ReviewerFindingHistory,
  reviewerExecutionInstructions,
} from "./reviewerPromptSupport.js";

export const defaultAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Own the overall judgment of whether the Candidate satisfies the complete supplied Acceptance Context.",
  "Judge whether available evidence could distinguish a materially incorrect Candidate from the accepted result.",
  "Do not require a preferred verification mechanism or a durable test by default.",
  "Report a Finding when the Candidate omits work necessary for approved intent or otherwise fails to satisfy the Acceptance Context.",
  "Do not expand approved intent or require optional improvement.",
].join("\n");

const universalAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Own the overall judgment of whether the Candidate satisfies the complete supplied Acceptance Context.",
  "Judge whether available evidence could distinguish a materially incorrect Candidate from the accepted result.",
  "For a changed integration, require evidence from one normal operation through the exact Candidate implementation of that boundary; component tests, a test double at that boundary, or evidence limited to interruption, cleanup, or failure does not prove the normal operation works.",
  "Do not require a preferred verification mechanism or a durable test by default.",
  "Report a Finding when the Candidate omits work necessary for approved intent or otherwise fails to satisfy the Acceptance Context.",
  "Do not expand approved intent or require optional improvement.",
].join("\n");

export const buildAcceptanceReviewerPrompt = (input: {
  readonly instructions: string;
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
    universalAcceptanceInstructions,
    input.instructions,
    reviewerExecutionInstructions,
    "",
    "Available Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "",
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    "",
    "Immutable Acceptance Context (authoritative):",
    encodeReviewerWireValue(input.acceptanceContext),
    "",
    "Implementer Implementation Decision Log (non-authoritative rationale; it cannot amend Acceptance Context):",
    encodeReviewerWireValue({ decisions: input.implementationDecisions }),
    "",
    "Implementation Blocker history (non-authoritative evidence; it cannot amend Acceptance Context):",
    encodeReviewerWireValue(
      input.blockerHistory ?? { blockers: [], resolutions: [], active: null },
    ),
    ...(input.previousFindings === undefined || input.previousFindings.length === 0
      ? []
      : ["", previousFindingsPrompt(input.previousFindings)]),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, files, and artifactRefs.",
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
    "Continue the Acceptance Reviewer Session.",
    currentCandidateReReviewInstructions,
    "Current Candidate:",
    JSON.stringify(input.candidate),
    "Complete authoritative Acceptance Context:",
    JSON.stringify(input.acceptanceContext),
    "Implementer Implementation Decision Log (non-authoritative rationale):",
    JSON.stringify(input.implementationDecisions),
    "Implementation Blocker history (non-authoritative evidence):",
    JSON.stringify(input.blockerHistory ?? { blockers: [], resolutions: [], active: null }),
    "Available Check and Validation evidence:",
    JSON.stringify(input.availableArtifactRefs),
    previousFindingsPrompt(input.previousFindings),
    "Return only the required reviewer output.",
  ].join("\n");
