import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import {
  candidateReviewerOutputInstructions,
  completeCandidateReviewInstructions,
  previousFindingsPrompt,
  type ReviewerFindingHistory,
  reviewerExecutionInstructions,
  reviewerExperimentInstructions,
} from "./reviewerPromptSupport.js";

export const defaultAcceptanceInstructions = [
  "Judge the exact Candidate against the complete immutable Acceptance Context and nothing materially beyond it.",
  "Use established acceptance techniques as attack paths, not as a complete checklist: requirements traceability, black-box observation, falsification and mutation thinking, equivalence partitioning, boundary-value analysis, state-transition analysis, decision tables, and contract testing at external boundaries.",
  "Derive every other relevant path from the accepted outcomes, constraints, and consequences.",
  "For each material claim, construct a plausible wrong result and require an actual observation with a trustworthy oracle that distinguishes the Candidate from it.",
  "Code inspection, apparent correctness, passing Checks, and maintained tests prove only what they directly observe; mocks at an integration boundary do not prove that boundary works.",
  "Report a Finding when evidence cannot distinguish a material wrong result, and require only the smallest sufficient evidence correction.",
  "Attack gold plating: every material Candidate-created obligation or consequence must be required by Acceptance Context or applicable authority.",
  "Implementation Decisions explain choices but cannot amend Acceptance Context; unresolved operator authority requires removal or an approved Blocker Resolution.",
  "Do not infer requirements from implementation or tests, demand optional improvement, or prescribe durable coverage when exact-work evidence is sufficient.",
  "Pass only after every material accepted claim and Candidate-created obligation survives review.",
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
    reviewerExperimentInstructions,
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
