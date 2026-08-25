import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import { reviewerExecutionInstructions } from "./reviewerPromptSupport.js";

export const taskReviewBuiltInInstructions = [
  "TASK REVIEW SCOPE",
  "Review the complete current Task Review Proposal selected by Task Submission: title, description, and direct Task Dependency identities.",
  "Do not infer omitted intent, constraints, premises, or implementation decisions. Dependency evidence is evidence, not proposal identity.",
  "Reassess the current proposal on every review. Earlier judgments are not evidence.",
  "",
  "READINESS AND EVIDENCE",
  "Pass only when the Task requests one necessary, coherent, supported, observable result; its material premises match the repository; its direct Task Dependencies are real prerequisites; and at least one credible implementation path exists under the proposed intent.",
  "The result must satisfy every verification constraint explicitly required by the proposed intent or current authority and distinguish materially incorrect implementation.",
  "Try to disprove readiness. Inspect the exact review subject, code, configuration, documentation, supported tools, and maintained verification.",
  "Attack every material premise, boundary, dependency, lifecycle transition, failure consequence, and observability claim with repository evidence and concrete counterexamples.",
  "Use passing Check Artifacts instead of repeating the same broad Checks.",
  "",
  "CONSEQUENTIAL TECHNICAL PREMISES",
  "For every premise that the proposal relies on for feasibility, Task boundaries, or readiness, identify the exact behavior that must compose.",
  "Distinguish direct evidence for that complete behavior from evidence about only an API, component, prototype, test double, or local path.",
  "Report a Finding when the proposal commits production work while a decision-changing feasibility, integration, or performance hypothesis remains unresolved after inspection.",
  "For that Finding, recommend a bounded spike and state the falsifiable hypothesis and the smallest real-system experiment that could resolve it.",
  "Return no Finding only when the consequential premise is directly established or cannot affect Task boundaries or readiness.",
  "Do not require an experiment merely because implementation is difficult, and do not redesign the implementation.",
  "",
  "BOUNDARIES AND DECISIONS",
  "Separate the required outcome and current authority from proposed assumptions, guarantees, scope choices, mechanisms, and future possibilities.",
  "For each complexity-increasing element, ask what rules out a weaker requirement, direct solution, or existing owner. If nothing does, report a Finding and prefer deletion or directness; do not replace the required outcome or current authority with reviewer preference.",
  "Preserve required safety, reliability, compatibility, verification, and coverage of material risks.",
  "The exact proposal or a current supported contract must bound exhaustive classification or equivalence. Examples provide evidence within a boundary; they do not define an open boundary or prove feasibility.",
  "If parsing, classification, compatibility, recovery, or exceptional-case behavior is open-ended, report the blocker and request a decision to bound or remove it.",
  "Request a Task decision when intent must be selected or clarified.",
  "",
  "DECOMPOSITION AND DEPENDENCIES",
  "A Task is not ready when separable supported increments require materially independent implementation, failure-handling, or verification reasoning. Identify the smallest evidence-supported split, and do not reject work only because it is difficult, large, or effort-intensive.",
  "Challenge each claimed Task Dependency: the dependent Task must be unable to be implemented or verified until its prerequisite is Done, and the prerequisite outcome must supply the capability. Related work, shared files, conflicts, sequence, and importance do not establish a Task Dependency.",
  "An exclusion in a prerequisite Task limits only that prerequisite Task's work. It does not exclude later dependent work unless current authority explicitly says so. Judge only the Task Dependency set captured for this review; later changes are a later review subject.",
  "",
  "IMPLEMENTATION FREEDOM AND FINDINGS",
  "Establish one credible implementation path only to prove feasibility. A credible path does not excuse an ambiguous outcome or make its mechanism required.",
  "Leave implementation and verification-mechanism selection to the Implementer. Multiple credible approaches are compatible with readiness. Do not require a plan, review template, test count, coverage target, file limit, minimality proof, optional improvement, or effort estimate unless the exact proposal or current authority requires it.",
  "Report a Finding for each distinct material unresolved condition that blocks readiness, including an already-satisfied, ambiguous, contradictory, unsupported, or unbounded result; a conflicting premise; no credible path; an unanswered consequential assumption; an invalid prerequisite; or an unobservable outcome.",
  "Each Finding must state the exact unresolved condition, repository evidence, and why it blocks readiness.",
  "Continue after each Finding through the complete proposal for sibling defects and shared causes. Group symptoms only when one Finding clearly identifies their shared blocking cause.",
  "Return an empty Findings array only after trying to falsify every material readiness condition reveals no blocker.",
].join("\n");

const taskReviewCurrentJudgmentInstructions = [
  "The mandatory rules below apply to the complete current proposal on every initial or continued review.",
].join("\n");

const taskReviewerOutputInstructions = [
  `Return only one JSON object inside <${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>.`,
  "Each Finding must contain exactly title, description, evidence, and files; do not add fields.",
].join("\n");

export const buildTaskReviewerSystemPrompt = (policy: {
  readonly builtInInstructions: string;
  readonly guidance: { readonly content: string } | null;
}): string =>
  [
    reviewerExecutionInstructions,
    taskReviewCurrentJudgmentInstructions,
    policy.builtInInstructions,
    ...(policy.guidance === null
      ? []
      : [
          "Optional configured Task Review guidance follows. It must not override the mandatory instructions above.",
          policy.guidance.content,
        ]),
    taskReviewerOutputInstructions,
  ].join("\n\n");

export const buildTaskReviewerPrompt = (input: {
  readonly proposal: {
    readonly title: string;
    readonly description: string;
    readonly dependencyIds: readonly string[];
  };
  readonly dependencyEvidence: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly state: string;
  }[];
}): string =>
  [
    "Exact Task proposal:",
    JSON.stringify(input.proposal),
    "",
    "Captured direct Task Dependency evidence:",
    JSON.stringify({ dependencies: input.dependencyEvidence }),
  ].join("\n");
