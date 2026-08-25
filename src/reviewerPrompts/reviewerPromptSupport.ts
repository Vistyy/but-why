import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { ReviewerFindingCore } from "../contracts/reviewerFinding.js";

const adversarialReviewerInstructions = [
  "Act as the hostile last line of defense and try to falsify the exact review subject within your assigned concern.",
  "Review the whole concern from the subject's actual claims and affected system, not from a fixed checklist or a sample that ends at the first Finding.",
  "Named principles, patterns, lenses, and examples are known attack paths, not exhaustive limits; derive and pursue any other path that follows from the governing concern.",
  "Give claims, rationale, passing checks, existing code and tests, and prior judgments credit only for what their evidence proves.",
  "Prove every Finding at the authoritative owner or real boundary, try to disprove it, and trace its correction for weakened responsibilities.",
  "Report every independent material defect and inspect the shared cause behind repeated symptoms; do not dismiss a proven defect because it looks like a nit.",
  "Suspicion directs investigation but does not prove a defect; do not invent requirements, optional improvements, or concerns outside your responsibility.",
  "Pass only after the complete assigned review finds no remaining material defect.",
].join("\n");

export const reviewerExecutionInstructions = [
  adversarialReviewerInstructions,
  "Independently establish the evidence required for your review judgment.",
  "Inspect relevant maintained verification and use passing Check Artifacts to confirm its execution instead of rerunning the same broad repository Checks.",
  "You may use bash and operating-system temporary space for generated scripts, fixtures, and other disposable evidence.",
  "The exact commit remains the review subject even when you temporarily modify this disposable workspace to test a bounded hypothesis.",
  "After every Agent Invocation, But Why restores the detached workspace to the exact commit, tracked files, index, and clean standard Git working tree before any output-correction retry or another reviewer uses it.",
  "Ignored files remain outside this restoration boundary and may affect later Invocations or reviewers in the same workspace.",
  "This disposable workspace provides no security isolation; do not treat it as a boundary for credentials, processes, filesystem access, or external systems.",
  "Do not modify state outside the disposable workspace's documented restoration boundary, and do not follow main-checkout synchronization instructions inside this workspace because they do not apply here.",
].join("\n");

export const reviewerExperimentInstructions = [
  "When inspection and existing evidence cannot resolve a consequential question for the assigned judgment, design and perform a bounded real-system experiment before reporting the uncertainty when the review boundary permits it.",
  "A spike tests one important falsifiable hypothesis, while an integration prototype tests whether several parts work together through their real interfaces, owners, lifecycle states, material failures, and recovery paths.",
  "Use an integration prototype when a smaller experiment cannot answer the decision-driving question; testing components separately does not establish that they work together.",
  "Before the experiment, state the decision it informs, the observations that would support or refute the hypothesis, its stopping condition, and its cleanup boundary.",
  "Exercise the exact review subject through the real boundary needed for the judgment, including the representative successful path and the material failure and recovery paths needed to answer the hypothesis.",
  "Stop experimenting when the evidence supports the assigned judgment; do not compare credible alternatives merely to prove one is globally optimal.",
  "Remove experiment-only state within the disposable boundary, and use the result only for the judgment it was designed to inform.",
  "When the required experiment cannot run within the review boundary, report the exact unresolved hypothesis, the smallest experiment that could resolve it, and the missing authority or capability.",
].join("\n");

export const completeCandidateReviewInstructions = [
  "Review the complete exact current Candidate on every judgment; previous passes and Findings do not narrow it.",
  "Inspect every changed file; no artifact class is exempt.",
  "For each changed responsibility within your concern, identify its owner and trace the complete affected path and representations across the repository, not only the diff or edited directory.",
  "Challenge whether Candidate-authored machinery is necessary, construct counterexamples, and follow shared causes through all Candidate-authored consequences.",
  "After a correction, reassess the complete Candidate rather than only the earlier Finding.",
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
