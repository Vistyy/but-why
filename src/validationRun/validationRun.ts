const validationRunStatuses = ["active", "failed", "error"] as const;
const validationPhases = [
  "preflight",
  "prepare",
  "checks",
  "acceptance_review",
  "quality_review",
  "publish_pr",
  "watch_pr",
] as const;
const validationPhaseStatuses = [
  "pending",
  "active",
  "passed",
  "failed",
  "skipped",
  "workflow_failed",
] as const;

export type ValidationRunStatus = (typeof validationRunStatuses)[number];
export type ValidationPhase = (typeof validationPhases)[number];
export type ValidationPhaseStatus = (typeof validationPhaseStatuses)[number];
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type GitHubPrTarget = {
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly remoteName: string;
  readonly remoteUrl: string;
};

export type ValidationRunRecord = {
  readonly id: string;
  readonly taskId: string;
  readonly taskValidationNumber: number;
  readonly status: ValidationRunStatus;
  readonly branch: string;
  readonly commitSha: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBaseBranch: string;
  readonly githubRemoteName: string;
  readonly githubRemoteUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ValidationRunPhaseStatusRecord = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly status: ValidationPhaseStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ValidationRunRoundRecord = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly status: ValidationPhaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ValidationRunFindingRecord = {
  readonly id: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly title: string;
  readonly description: string;
  readonly severity?: FindingSeverity;
  readonly evidence: string;
  readonly files: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ValidationRunArtifactRecord = {
  readonly ref: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes?: number;
  readonly storedBytes?: number;
  readonly truncated?: boolean;
  readonly createdAt: string;
};
