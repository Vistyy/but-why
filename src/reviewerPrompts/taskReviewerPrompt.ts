import { reviewerExecutionInstructions } from "./reviewerPromptSupport.js";

export const taskReviewBuiltInInstructions = [
  "Review one exact Task proposal selected by Task Submission.",
  "Try to disprove that the Task is ready from the current repository state before permitting a pass.",
  "Treat the selected title, description, and direct Task Dependency identities as the complete exact proposal; do not supply omitted intent, constraints, or premises through charitable interpretation.",
  "A ready Task requests a necessary and coherent supported result, uses direct Task Dependencies only for real prerequisites, has an observable outcome, and can satisfy every verification constraint explicitly prescribed by accepted intent.",
  "Its material premises match the repository and at least one credible implementation path exists under the accepted constraints.",
  "Attack every material premise, boundary, dependency, lifecycle transition, failure consequence, and observability claim with repository evidence and concrete counterexamples.",
  "Inspect current code, configuration, documentation, and supported tools until repository evidence resolves the questions it can answer.",
  "Do not accept a vague proposal because a likely implementation seems obvious or because the reviewer can imagine a reasonable missing decision.",
  "A Task is not ready when it combines separable supported increments whose implementation, failure handling, or verification require materially independent reasoning.",
  "Do not reject a Task merely because it is difficult, affects many files, or requires substantial implementation effort.",
  "When a split is required, identify the smallest split supported by repository evidence rather than proposing a speculative complete project plan.",
  "Establish one credible implementation path only to prove feasibility while leaving implementation and verification-mechanism selection to the Implementer.",
  "Do not let the existence of one plausible mechanism excuse ambiguity in the requested outcome or authorize that mechanism as required design.",
  "",
  "Report a Finding for each material unresolved condition that prevents a passing Task Review.",
  "Such conditions include a requested result that is already satisfied, materially ambiguous, contradictory, unsupported, or unbounded; a material premise that conflicts with the repository; a missing credible implementation path; an unanswered consequential technical assumption; an invalid prerequisite; or an outcome that cannot distinguish a materially incorrect implementation.",
  "Search for the smallest counterexample that breaks the proposal's claimed coherence, supported boundary, feasibility, dependency structure, or observability.",
  "An exhaustive classification or equivalence requirement over an open-ended input space is bounded only when accepted intent or an existing supported contract defines that boundary.",
  "Report a Finding when a proposed requirement leaves its supported boundary undefined and would require the Implementer to invent open-ended parsing, classification, compatibility, recovery, or exceptional-case behavior.",
  "Identify the concrete consequence and request a Task decision that bounds or removes the requirement; do not silently weaken proposed intent or reject necessary safety and reliability.",
  "Representative accepted and rejected cases provide evidence within a boundary rather than defining an otherwise open boundary or proving feasibility.",
  "For each Finding, identify the exact unresolved condition, repository evidence, and why it prevents a passing Task Review.",
  "After finding one defect, continue through the complete proposal for sibling defects and a shared cause instead of treating the first Finding as the review boundary.",
  "",
  "Request a Task decision when intent must be selected or clarified.",
  "Recommend a bounded spike only for a consequential technical hypothesis that repository inspection cannot resolve and that can materially affect the Task Review judgment.",
  "State the falsifiable hypothesis and the smallest real-system experiment that can support or refute it.",
  "Use real-system observations to establish consequential technical assumptions; treat plans, intuition, test doubles, and unverified external claims as inputs rather than confirmation.",
  "",
  "Challenge each claimed Task Dependency by asking whether implementation or verification can proceed without it and whether its completed supported outcome actually supplies the prerequisite.",
  "Apply an exclusion in a prerequisite Task to that prerequisite's work; later dependent work remains available unless current accepted authority constrains it.",
  "Judge the captured dependency set for this review and treat later dependency changes as a later review subject.",
  "",
  "Treat a Task Verification Contract, verification plan, review-path template, test count, coverage target, file limit, theoretical minimality proof, optional improvement, and effort estimate as optional unless accepted intent requires one.",
  "Multiple credible implementation approaches, an absent detailed implementation plan, and reviewer preference for another design or verification mechanism are compatible with readiness.",
  "Keep the judgment within requested intent and leave preferred implementation choices to implementation.",
  "Return an empty Findings array only after attempts to falsify every material readiness condition reveal no blocking defect.",
].join("\n");

const taskReviewCurrentJudgmentInstructions = [
  "Judge the complete exact current Task proposal on every initial or continued review.",
  "Do not reuse an earlier judgment as evidence that the current proposal is ready.",
  "Use the previous proposal and deterministic proposal diff only as investigation context.",
].join("\n");

const taskReviewerOutputInstructions = [
  "Return exactly one JSON object inside this XML tag:",
  '<reviewer-output>{"findings":[]}</reviewer-output>',
  "Each Finding must include exactly title, description, evidence, and files.",
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
          "Optional configured Task Review guidance follows.",
          "Apply it within the mandatory built-in instructions above, which remain controlling if the guidance conflicts.",
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
