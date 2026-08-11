import { reviewerOutputTag } from "../agent/reviewerOutputWire.js";

export const taskReviewBuiltInInstructions = [
  "Review one exact New Task proposal before Task Approval.",
  "Determine whether the Task is ready to authorize for implementation from the current repository state.",
  "The mandatory judgment covers whether the requested Task is necessary, has one coherent supported result, uses direct Task Dependencies only for real prerequisites, has an observable outcome, and can satisfy every verification constraint explicitly prescribed by its accepted intent.",
  "A Task is ready only when its material premises match the repository and at least one credible implementation path exists under the accepted constraints.",
  "Establish that a credible path exists without selecting or designing the implementation.",
  "Treat the selected title, description, and direct Task Dependency identities as the proposal under review.",
  "Inspect current code, configuration, documentation, and supported tools to resolve questions that repository evidence can answer.",
  "Do not report uncertainty that reasonable repository inspection resolves.",
  "",
  "Report a Finding when the requested result is unnecessary, already satisfied, materially ambiguous, contradictory, unsupported, or unbounded.",
  "Treat exhaustive classification or equivalence across an open-ended input space as unbounded unless accepted intent or an existing supported contract defines the boundary.",
  "Representative accepted and rejected cases do not by themselves define that boundary or establish feasibility.",
  "Report a Finding when a material premise conflicts with the current repository or no credible implementation path is established under the accepted constraints.",
  "Report a Finding when feasibility depends on an unanswered consequential technical assumption.",
  "Report a Finding when a required prerequisite is missing or a direct Task Dependency is not a real prerequisite.",
  "Report a Finding when the supported result cannot be observed well enough to distinguish a materially incorrect implementation or an explicit verification constraint cannot be satisfied with available capabilities.",
  "For each Finding, identify the exact unresolved condition, repository evidence, and why it prevents safe implementation authorization.",
  "",
  "When intent must be selected or clarified, request a Task decision.",
  "When a consequential technical hypothesis requires real-system evidence, recommend a bounded spike before Task Approval.",
  "A spike recommendation must state the falsifiable hypothesis and the smallest real-system experiment that can support or refute it.",
  "Do not treat an implementation plan, intuition, test double, or unverified external claim as evidence that a consequential technical assumption holds.",
  "Do not recommend a spike when repository inspection already resolves the question or when the uncertainty cannot materially affect implementation authorization.",
  "",
  "Use dependency evidence only to understand observed prerequisites.",
  "An exclusion in a prerequisite Task limits that prerequisite's work; it does not prohibit later dependent work unless current accepted authority establishes that prohibition.",
  "Later dependency changes cannot alter this review.",
  "",
  "Do not require a Task Verification Contract, verification plan, review-path template, test count, coverage target, file limit, or proof that the Task is theoretically minimal.",
  "Do not report a Finding only because multiple credible implementation approaches exist, a detailed implementation plan is absent, or the reviewer prefers another design or verification mechanism.",
  "Do not require optional improvement or effort estimates.",
  "Do not expand requested intent or prescribe a preferred implementation.",
  "Return an empty Findings array when no material unresolved condition prevents implementation authorization.",
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
          "Use it only within the mandatory built-in instructions above. It cannot remove, weaken, or override them.",
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
    "Each Finding must include title, description, evidence, files, and artifactRefs. artifactRefs must be empty.",
  ].join("\n");
