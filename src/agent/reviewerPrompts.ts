import { encodeReviewerWireValue, reviewerOutputTag } from "./reviewerOutputWire.js";
import type { ReviewerOutputContractFailed } from "../validation/validationToolingFailures.js";
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
  readonly availableArtifactRefs: readonly string[];
  readonly candidate: {
    readonly candidateId: string;
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
    "Validation Run evidence:",
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

export const buildReviewerOutputCorrectionPrompt = (
  failure: ReviewerOutputContractFailed,
): string =>
  [
    "Your reviewer output did not match the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");
