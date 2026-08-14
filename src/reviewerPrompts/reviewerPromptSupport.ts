import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { ReviewerFindingCore } from "../contracts/reviewerFinding.js";

export const reviewerExecutionInstructions = [
  "Independently establish the evidence required for your review judgment.",
  "Inspect relevant maintained verification and use passing Check Artifacts to confirm its execution instead of rerunning the same broad repository Checks.",
  "When inspection and existing evidence are insufficient, design and perform a proportionate targeted experiment through the exact Candidate.",
  "You may use bash and operating-system temporary space for generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the Candidate. Candidate integrity verification by But Why is authoritative.",
].join("\n");

const continuedReviewerJudgmentInstructions = [
  "Re-anchor the review to the exact current subject and supplied current authority.",
  "If your most recent completed judgment passed and the applicable authority remains unchanged, use that judgment as the baseline.",
  "Focus on the current subject delta and how it affects your prior conclusions instead of repeating unaffected investigation.",
  "If your most recent completed judgment reported Findings, recheck them and inspect the corrective delta for new material problems.",
  "Expand the review when the current delta or changed authority can invalidate an earlier conclusion.",
  "Return every material Finding within your current reviewer responsibility.",
].join("\n");

export const currentCandidateReReviewInstructions = [
  continuedReviewerJudgmentInstructions,
  "Inspect the Candidate delta, changed files, and directly affected callers, tests, and owning modules.",
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

export const buildReviewerOutputCorrectionPrompt = (failure: {
  readonly message: string;
}): string =>
  [
    "Your reviewer output did not satisfy the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");
