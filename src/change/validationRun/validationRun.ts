export const validationPhase = {
  prepare: "prepare",
  checks: "checks",
  acceptanceReview: "acceptance_review",
  specialistReview: "specialist_review",
} as const;

export type ValidationPhase = (typeof validationPhase)[keyof typeof validationPhase];

export type GitHubPrTarget = {
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly remoteName: string;
  readonly remoteUrl: string;
};

export type ValidationRunFindingRecord = {
  readonly id: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly title: string;
  readonly description: string;
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
