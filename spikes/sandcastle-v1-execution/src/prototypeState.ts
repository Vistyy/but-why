export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface StepRecord {
  readonly id: string;
  readonly title: string;
  readonly status: StepStatus;
  readonly detail?: string;
}

export interface CheckRound {
  readonly id: string;
  readonly command: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly finding?: Finding;
}

export interface Finding {
  readonly title: string;
  readonly description: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly evidence: string;
  readonly files: readonly string[];
  readonly artifactRefs: readonly string[];
}

export interface ReviewerRound {
  readonly id: string;
  readonly status: StepStatus;
  readonly findings?: readonly Finding[];
  readonly logFilePath?: string;
  readonly sessionId?: string;
  readonly tokenUsage?: TokenUsage;
  readonly error?: string;
}

export interface TokenUsage {
  readonly producerId: string;
  readonly agentRuntime: "pi";
  readonly agentModel: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly raw?: unknown;
}

export interface SpikeState {
  readonly question: string;
  readonly steps: readonly StepRecord[];
  readonly fixtureRepoPath?: string;
  readonly submittedCommit?: string;
  readonly tempValidationRef?: string;
  readonly worktreePath?: string;
  readonly worktreeHead?: string;
  readonly originalHeadAfterWorkspace?: string;
  readonly originalBranchAfterWorkspace?: string;
  readonly originalStatusAfterWorkspace?: string;
  readonly checks: readonly CheckRound[];
  readonly reviewers: readonly ReviewerRound[];
  readonly sandcastleVersion?: string;
  readonly sandboxProvider?: string;
  readonly cleanup?: {
    readonly worktreeClosed?: boolean;
    readonly tempRefDeleted?: boolean;
    readonly fixtureRemoved?: boolean;
  };
}

export type SpikeEvent =
  | { readonly type: "stepStarted"; readonly id: string }
  | { readonly type: "stepPassed"; readonly id: string; readonly detail?: string }
  | { readonly type: "stepFailed"; readonly id: string; readonly detail: string }
  | { readonly type: "stepSkipped"; readonly id: string; readonly detail: string }
  | { readonly type: "fixtureReady"; readonly repoPath: string; readonly submittedCommit: string; readonly tempValidationRef: string }
  | {
      readonly type: "workspaceReady";
      readonly worktreePath: string;
      readonly worktreeHead: string;
      readonly originalHeadAfterWorkspace: string;
      readonly originalBranchAfterWorkspace: string;
      readonly originalStatusAfterWorkspace: string;
    }
  | { readonly type: "checkRecorded"; readonly check: CheckRound }
  | { readonly type: "reviewerRecorded"; readonly reviewer: ReviewerRound }
  | { readonly type: "metadata"; readonly sandcastleVersion?: string; readonly sandboxProvider?: string }
  | { readonly type: "cleanupRecorded"; readonly cleanup: NonNullable<SpikeState["cleanup"]> };

const initialSteps: readonly StepRecord[] = [
  { id: "fixture", title: "Create disposable git fixture and temp validation ref", status: "pending" },
  { id: "workspace", title: "Create Sandcastle validation worktree from temp ref", status: "pending" },
  { id: "checks", title: "Run configured command checks through Sandcastle", status: "pending" },
  { id: "reviewer-valid", title: "Run Pi reviewer with structured Finding JSON", status: "pending" },
  { id: "reviewer-retry", title: "Prove same-thread structured output retry", status: "pending" },
  { id: "cleanup", title: "Clean up validation worktree and temp ref", status: "pending" },
];

export const initialState = (): SpikeState => ({
  question:
    "Can But Why? use Sandcastle 0.12.0 to create a validation worktree from a Run-owned temp ref without touching the original checkout? PROTOTYPE - throwaway logic prototype for issue 011.",
  steps: initialSteps,
  checks: [],
  reviewers: [],
});

export const applyEvent = (state: SpikeState, event: SpikeEvent): SpikeState => {
  const setStep = (status: StepStatus, detail?: string): SpikeState => {
    if (!("id" in event)) return state;
    return {
      ...state,
      steps: state.steps.map((step) =>
        step.id === event.id ? { ...step, status, detail } : step,
      ),
    };
  };

  switch (event.type) {
    case "stepStarted":
      return setStep("running");
    case "stepPassed":
      return setStep("passed", event.detail);
    case "stepFailed":
      return setStep("failed", event.detail);
    case "stepSkipped":
      return setStep("skipped", event.detail);
    case "fixtureReady":
      return {
        ...state,
        fixtureRepoPath: event.repoPath,
        submittedCommit: event.submittedCommit,
        tempValidationRef: event.tempValidationRef,
      };
    case "workspaceReady":
      return {
        ...state,
        worktreePath: event.worktreePath,
        worktreeHead: event.worktreeHead,
        originalHeadAfterWorkspace: event.originalHeadAfterWorkspace,
        originalBranchAfterWorkspace: event.originalBranchAfterWorkspace,
        originalStatusAfterWorkspace: event.originalStatusAfterWorkspace,
      };
    case "checkRecorded":
      return { ...state, checks: [...state.checks, event.check] };
    case "reviewerRecorded":
      return { ...state, reviewers: [...state.reviewers, event.reviewer] };
    case "metadata":
      return {
        ...state,
        sandcastleVersion: event.sandcastleVersion ?? state.sandcastleVersion,
        sandboxProvider: event.sandboxProvider ?? state.sandboxProvider,
      };
    case "cleanupRecorded":
      return { ...state, cleanup: event.cleanup };
  }
};
