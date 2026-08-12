import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";

export const taskReviewBuiltInInstructions = [
  "Review one exact Task proposal selected by Task Submission.",
  "Determine whether the Task is ready for a passing Task Review from the current repository state.",
  "A ready Task requests a necessary and coherent supported result, uses direct Task Dependencies only for real prerequisites, has an observable outcome, and can satisfy every verification constraint explicitly prescribed by accepted intent.",
  "Its material premises match the repository and at least one credible implementation path exists under the accepted constraints.",
  "A Task is not ready when it combines separable supported increments whose implementation, failure handling, or verification require materially independent reasoning.",
  "Do not reject a Task merely because it is difficult, affects many files, or requires substantial implementation effort.",
  "When a split is required, identify the smallest split supported by repository evidence rather than proposing a speculative complete project plan.",
  "Establish that credible path at the Task Review level while leaving implementation and verification-mechanism selection to the Implementer.",
  "Treat the selected title, description, and direct Task Dependency identities as the exact proposal under review.",
  "Inspect current code, configuration, documentation, and supported tools until repository evidence resolves the questions it can answer.",
  "",
  "Report a Finding for each material unresolved condition that prevents a passing Task Review.",
  "Such conditions include a requested result that is already satisfied, materially ambiguous, contradictory, unsupported, or unbounded; a material premise that conflicts with the repository; a missing credible implementation path; an unanswered consequential technical assumption; an invalid prerequisite; or an outcome that cannot distinguish a materially incorrect implementation.",
  "An exhaustive classification or equivalence requirement over an open-ended input space is bounded only when accepted intent or an existing supported contract defines that boundary.",
  "Representative accepted and rejected cases provide evidence within a boundary rather than defining an otherwise open boundary or proving feasibility.",
  "For each Finding, identify the exact unresolved condition, repository evidence, and why it prevents a passing Task Review.",
  "",
  "Request a Task decision when intent must be selected or clarified.",
  "Recommend a bounded spike only for a consequential technical hypothesis that repository inspection cannot resolve and that can materially affect the Task Review judgment.",
  "State the falsifiable hypothesis and the smallest real-system experiment that can support or refute it.",
  "Use real-system observations to establish consequential technical assumptions; treat plans, intuition, test doubles, and unverified external claims as inputs rather than confirmation.",
  "",
  "Use dependency evidence to understand observed prerequisites.",
  "Apply an exclusion in a prerequisite Task to that prerequisite's work; later dependent work remains available unless current accepted authority constrains it.",
  "Judge the captured dependency set for this review and treat later dependency changes as a later review subject.",
  "",
  "Treat a Task Verification Contract, verification plan, review-path template, test count, coverage target, file limit, theoretical minimality proof, optional improvement, and effort estimate as optional unless accepted intent requires one.",
  "Multiple credible implementation approaches, an absent detailed implementation plan, and reviewer preference for another design or verification mechanism are compatible with readiness.",
  "Keep the judgment within requested intent and leave preferred implementation choices to implementation.",
  "Return an empty Findings array when no material unresolved condition prevents a passing Task Review.",
].join("\n");

export const buildTaskReviewerPrompt = (input: {
  readonly policy: {
    readonly builtInInstructions: string;
    readonly guidance: { readonly content: string } | null;
  };
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
    input.policy.builtInInstructions,
    ...(input.policy.guidance === null
      ? []
      : [
          "",
          "Optional configured Task Review guidance follows.",
          "Apply it within the mandatory built-in instructions above, which remain controlling if the guidance conflicts.",
          input.policy.guidance.content,
        ]),
    "",
    "Exact Task proposal:",
    JSON.stringify(input.proposal),
    "",
    "Captured direct Task Dependency evidence:",
    JSON.stringify({ dependencies: input.dependencyEvidence }),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include exactly title, description, evidence, and files.",
  ].join("\n");
