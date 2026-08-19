import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import {
  candidateReviewerOutputInstructions,
  completeCandidateReviewInstructions,
  previousFindingsPrompt,
  type ReviewerFindingHistory,
  reviewerExecutionInstructions,
} from "./reviewerPromptSupport.js";

export const defaultAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Try to falsify the claim that the Candidate satisfies every material part of the complete Acceptance Context before permitting a pass.",
  "For each material accepted outcome or constraint, construct a plausible incorrect implementation and establish which exact observation distinguishes it from the Candidate.",
  "Attack the Candidate through representative normal behavior and every materially affected failure, retry, interruption, recovery, reconciliation, migration, and cleanup consequence within accepted intent.",
  "Independently establish whether the evidence observes the exact Candidate and could distinguish a materially incorrect result from the accepted result.",
  "Treat passing Checks, maintained tests, implementation rationale, and prior Findings as untrusted inputs rather than proof of acceptance.",
  "Do not excuse missing accepted behavior because the implementation is internally consistent, extensively tested, difficult to change, or based on a plausible design choice.",
  "Attack material Candidate behavior that the Acceptance Context and applicable authority do not require, especially added supported behavior, interfaces, stored state, compatibility, failure handling, recovery, or operator obligations.",
  "Distinguish an ordinary implementation choice needed to realize accepted intent from behavior that expands or changes the accepted result.",
  "Do not let useful, defensive, or well-tested additional behavior pass merely because it could be desirable.",
  "When a material choice within accepted intent affects observable behavior, an interface, stored data, failure handling, or a meaningful trade-off, require it to be visible in the Implementation Decision Log; do not require a Decision for routine coding choices.",
  "An Implementation Decision may explain a material choice but cannot authorize behavior outside Acceptance Context.",
  "When safe implementation required unresolved operator authority, do not accept a silently selected result; require removal of the unauthorized behavior or an Implementation Blocker and approved Resolution reflected in the current Acceptance Context before a later Candidate can pass.",
  "Do not require a preferred verification mechanism or a durable test by default.",
  "Report a Finding when the Candidate omits required work, adds unauthorized material behavior, hides a required material decision, or otherwise fails to satisfy the Acceptance Context.",
  "After finding one violation, continue through the complete Acceptance Context for sibling violations and shared causes.",
  "Do not expand approved intent or require optional improvement.",
  "Return no Findings only after attempts to falsify every material acceptance claim reveal no defect.",
].join("\n");

const universalAcceptanceInstructions = [
  defaultAcceptanceInstructions,
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
  readonly validationRunId: number;
  readonly availableArtifactRefs: readonly string[];
  readonly previousFindings?: readonly ReviewerFindingHistory[];
  readonly candidate: {
    readonly candidateId: number;
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
    readonly candidateId: number;
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
    "Continue the Acceptance Agent Session with the current evidence below.",
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
