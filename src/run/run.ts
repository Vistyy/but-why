export const runStatuses = ["active", "error"] as const;

export type RunStatus = (typeof runStatuses)[number];

export type RunRecord = {
  readonly id: string;
  readonly taskId: string;
  readonly taskRunNumber: number;
  readonly status: RunStatus;
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

const runStatusSet = new Set<string>(runStatuses);

export const isRunStatus = (value: string): value is RunStatus => runStatusSet.has(value);
