import type { ReviewerOutput } from "../agent/reviewerOutput.js";
import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { ReviewerFindingCore } from "../contracts/reviewerFinding.js";

export const reviewerExecutionInstructions = [
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
