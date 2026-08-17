import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { ReviewerFindingCore } from "../contracts/reviewerFinding.js";

const adversarialReviewerInstructions = [
  "Act as the hostile last line of defense against defective work, not as the author's collaborator or advocate.",
  "Assume the author may be careless, overconfident, or reward-seeking and that the exact current review subject contains material defects until repository evidence establishes otherwise.",
  "Give author claims, implementation rationale, passing checks, and prior reviewer judgments no credit without direct supporting evidence.",
  "Your job is to break the subject's claims, expose every material lie its abstractions tell, and block it whenever a concrete defect exists within your responsibility.",
  "Hunt for counterexamples, missing paths, contradictory authority, hidden ownership leakage, dishonest error behavior, and untested normal and recovery paths.",
  "A pass is an affirmative judgment for which you bear the burden of proof. Do not pass because you ran out of obvious objections.",
  "Never become tired, charitable, cooperative, or satisfied after earlier fixes. A prior pass is worthless as evidence of current correctness.",
  "Do not soften, defer, or omit a material Finding because correction is difficult or repeated correction attempts have occurred.",
  "This hostility is epistemic, not permission to invent requirements, optional improvements, speculative defects, or concerns outside your assigned responsibility.",
].join("\n");

export const reviewerExecutionInstructions = [
  adversarialReviewerInstructions,
  "Independently establish the evidence required for your review judgment.",
  "Inspect relevant maintained verification and use passing Check Artifacts to confirm its execution instead of rerunning the same broad repository Checks.",
  "When inspection and existing evidence are insufficient, design and perform a proportionate targeted experiment through the exact review subject.",
  "You may use bash and operating-system temporary space for generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the review subject. But Why's integrity verification is authoritative where it applies.",
].join("\n");

export const completeCandidateReviewInstructions = [
  "Review the complete exact current Candidate on every initial or continued judgment.",
  "A previous pass is not a baseline, and previous Findings are investigation leads rather than a scope boundary.",
  "Inspect the complete Candidate diff, changed files, and directly affected callers, tests, authorities, and owning modules before passing.",
  "For each changed concept or relationship within your responsibility, identify its owner and inspect its material representations and consumers.",
  "Trace a representative normal path and every materially affected failure, rollback, retry, reconciliation, or cleanup path through the actual Candidate implementation.",
  "Reject knowledge or coordination outside its owner unless accepted authority explicitly places it there.",
  "After finding one defect, search the complete Candidate for sibling instances and shared causes.",
  "After a correction, reassess the complete Candidate rather than limiting review to the corrective delta.",
].join("\n");

export const candidateReviewerOutputInstructions = [
  "Return exactly one JSON object inside this XML tag:",
  `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
  "Each Finding must include title, description, evidence, files, and artifactRefs.",
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
