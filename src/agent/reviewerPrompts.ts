import { encodeReviewerWireValue, reviewerOutputTag } from "./reviewerOutputWire.js";
import type { ReviewerOutputContractFailed } from "../validation/validationToolingFailures.js";
import type { ReviewerOutput } from "../contracts/reviewerOutput.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export const defaultAcceptanceInstructions = [
  "Review the exact Candidate against the supplied immutable Acceptance Context.",
  "Inspect the repository and Candidate diff before deciding.",
  "Report each material mismatch between the Candidate and the approved Task intent as a Finding.",
  "Return an empty findings array when the Candidate fully satisfies the approved intent.",
].join("\n");

export const buildAcceptanceReviewerPrompt = (input: {
  readonly instructions: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly candidateId: string;
    readonly comparisonBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: TaskContextSnapshotV1;
}): string =>
  [
    input.instructions,
    "",
    "Validation Run evidence:",
    encodeReviewerWireValue({
      validationRunId: input.validationRunId,
      availableArtifactRefs: input.availableArtifactRefs,
    }),
    "",
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    "",
    "Immutable Acceptance Context:",
    encodeReviewerWireValue(input.acceptanceContext),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must contain title, description, severity, evidence, files, and artifactRefs.",
  ].join("\n");

export const buildSpecialistReviewerPrompt = (input: {
  readonly specialist: string;
  readonly instructions: string;
  readonly validationRunId: string;
  readonly candidate: {
    readonly comparisonBaseSha: string;
    readonly headSha: string;
  };
}): string =>
  [
    input.instructions,
    "",
    `Specialist: ${input.specialist}`,
    "Judge the exact Candidate only for this configured concern.",
    "Inspect the repository and Candidate diff before deciding.",
    "",
    "Validation Run:",
    encodeReviewerWireValue({ validationRunId: input.validationRunId }),
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
    "Earlier Findings from your review of the immediately preceding Candidate:",
    encodeReviewerWireValue({ findings: input.earlierFindings }),
    "",
    "Recheck the Candidate against the applicable instructions.",
    "Verify whether each earlier Finding remains open, then return one final report containing every open earlier Finding and every new Finding.",
  ].join("\n");

export const buildReviewerOutputCorrectionPrompt = (
  failure: ReviewerOutputContractFailed,
): string =>
  [
    "Your reviewer output did not match the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");
