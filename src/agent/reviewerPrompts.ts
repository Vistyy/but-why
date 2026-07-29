import { encodeReviewerWireValue, reviewerOutputTag } from "./reviewerOutputWire.js";
import type { ReviewerOutputContractFailed } from "../change/validation/validationToolingFailures.js";
import type { ReviewerOutput } from "../contracts/reviewerOutput.js";
import type { TaskContextSnapshotV1 } from "../change/validationRun/taskContextSnapshot.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { ImplementationBlockerHistory } from "../change/implementationBlocker.js";

const reviewerExecutionInstructions = [
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "Use passing Check Artifacts for broad validation evidence instead of rerunning the same broad repository Checks.",
  "You must not modify the Candidate. Candidate integrity verification by But Why is authoritative.",
].join("\n");

export const defaultAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Inspect the repository and Candidate diff before deciding.",
  "Report each material mismatch with the approved Task intent as a Finding.",
  "Return an empty findings array when the Candidate satisfies the approved intent.",
].join("\n");

export const buildAcceptanceReviewerPrompt = (input: {
  readonly instructions: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly blockerHistory?: ImplementationBlockerHistory;
}): string =>
  [
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
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, severity, evidence, files, and artifactRefs.",
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
}): string =>
  [
    input.instructions,
    reviewerExecutionInstructions,
    "",
    `Specialist: ${input.specialist}`,
    "Review the exact Candidate only for the configured concern.",
    "Inspect the repository and Candidate diff before deciding.",
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
    "Each Finding must contain title, description, severity, evidence, files, and artifactRefs.",
  ].join("\n");

export type ReviewerFindingHistory = {
  readonly title: string;
  readonly description: string;
  readonly severity?: "critical" | "high" | "medium" | "low";
  readonly evidence: string;
  readonly files: readonly string[];
  readonly artifactRefs: readonly string[];
};

export const reviewerFindingHistory = (
  findings: readonly ReviewerFindingHistory[],
): readonly ReviewerFindingHistory[] =>
  findings.map(({ title, description, severity, evidence, files, artifactRefs }) => ({
    title,
    description,
    ...(severity === undefined ? {} : { severity }),
    evidence,
    files,
    artifactRefs,
  }));

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
    "Findings from the latest earlier valid report:",
    encodeReviewerWireValue({ findings: input.earlierFindings }),
    "",
    "Recheck the Candidate against the applicable instructions.",
    "Confirm whether each earlier Finding remains open.",
    "Return one final report with every open earlier Finding and every new Finding.",
  ].join("\n");

export const buildReviewerOutputCorrectionPrompt = (
  failure: ReviewerOutputContractFailed,
): string =>
  [
    "Your reviewer output did not satisfy the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");
