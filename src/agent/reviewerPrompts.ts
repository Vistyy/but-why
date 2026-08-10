import type { ImplementationBlockerHistory } from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import type { ReviewerFindingCore } from "../contracts/reviewerFinding.js";
import type { ReviewerOutput } from "../contracts/reviewerOutput.js";
import { encodeReviewerWireValue, reviewerOutputTag } from "./reviewerOutputWire.js";

const reviewerExecutionInstructions = [
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "Use passing Check Artifacts for broad validation evidence instead of rerunning the same broad repository Checks.",
  "You must not modify the Candidate. Candidate integrity verification by But Why is authoritative.",
].join("\n");

export const currentCandidateReReviewInstructions = [
  "Re-anchor the review to the exact current Candidate.",
  "Inspect the Candidate delta, changed files, and directly affected callers, tests, and owning modules.",
  "Recheck the previous Findings, but do not limit the review to them.",
  "Return every material Finding that applies to the exact current Candidate.",
  "Reuse prior repository orientation unless current evidence requires additional exploration.",
].join("\n");

export const defaultAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Own the overall judgment of whether the Candidate satisfies the complete supplied Acceptance Context.",
  "Report a Finding when the Candidate omits work necessary for approved intent or otherwise fails to satisfy the Acceptance Context.",
  "Do not expand approved intent or require optional improvement.",
].join("\n");

const universalAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Own the overall judgment of whether the Candidate satisfies the complete supplied Acceptance Context.",
  "Report a Finding when the Candidate omits work necessary for approved intent or otherwise fails to satisfy the Acceptance Context.",
  "Do not expand approved intent or require optional improvement.",
].join("\n");

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

const acceptanceContextConstraint = (context: AcceptanceContextSnapshotV1): string =>
  [
    "Immutable Acceptance Context (authoritative scope constraint):",
    encodeReviewerWireValue(context),
    "Use this context only to constrain Findings and required corrections.",
    "Do not expand or contradict approved intent.",
    "Do not require behavior that the context excludes.",
    "Respect explicit verification constraints in the context.",
    "Do not invent required verification mechanisms or demand evidence beyond what is necessary to judge approved intent.",
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
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly blockerHistory?: ImplementationBlockerHistory;
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
    encodeReviewerWireValue({ decisions: input.implementationDecisions ?? [] }),
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

export const buildSpecialistReviewerPrompt = (input: {
  readonly specialist: string;
  readonly instructions: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext?: AcceptanceContextSnapshotV1;
}): string =>
  [
    universalSpecialistInstructions,
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
  readonly acceptanceContext?: AcceptanceContextSnapshotV1;
}): string =>
  [
    universalSpecialistInstructions,
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

export type ReviewerFindingHistory = ReviewerFindingCore;

type PersistedReviewerFinding = ReviewerFindingCore & {
  readonly artifactRefs: readonly string[];
};

export const reviewerFindingHistory = (
  findings: readonly PersistedReviewerFinding[],
): readonly ReviewerFindingHistory[] =>
  findings.map(({ title, description, evidence, files }) => ({
    title,
    description,
    evidence,
    files,
  }));

export const previousFindingsPrompt = (findings: readonly unknown[]): string =>
  [
    "Previous Findings:",
    encodeReviewerWireValue({ findings }),
    "These Findings apply to the previous Candidate and are context for reviewing the exact current Candidate.",
    "Recheck them, but do not limit the current review to them.",
    "Historical Artifact references are not current Validation Run evidence and have been omitted.",
    "Final Finding artifactRefs may use only the available current Validation Run evidence.",
  ].join("\n");

export const buildReviewerRevisionPrompt = (input: {
  readonly reviewPrompt: string;
  readonly provisionalReport: ReviewerOutput;
  readonly earlierFindings: readonly ReviewerFindingHistory[];
}): string =>
  [
    input.reviewPrompt,
    "",
    "Blind provisional report:",
    encodeReviewerWireValue(input.provisionalReport),
    "",
    previousFindingsPrompt(input.earlierFindings),
    "",
    "Recheck the Candidate against the applicable instructions.",
    "Confirm whether each earlier Finding remains open.",
    "Return one final report with every open earlier Finding and every new Finding.",
  ].join("\n");

export const buildReviewerOutputCorrectionPrompt = (failure: {
  readonly message: string;
}): string =>
  [
    "Your reviewer output did not satisfy the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");
