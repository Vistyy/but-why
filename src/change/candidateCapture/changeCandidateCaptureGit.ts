import type { Effect } from "effect";

export type LocalCandidateWorkspace = {
  readonly repositoryCommonDirectory: string;
  readonly primaryRoot: string;
  readonly branchRef: string;
  readonly headSha: string;
  readonly renameFromRef?: string;
};

export type LocalCandidateWorkspaceResult =
  | { readonly ok: true; readonly facts: LocalCandidateWorkspace }
  | {
      readonly ok: false;
      readonly code:
        | "detached_head"
        | "unborn_branch"
        | "dirty_work"
        | "conflicting_branch_facts"
        | "git_tooling_error";
    };

export type ChangeCandidateCaptureGit = {
  readonly readWorkspace: (cwd: string) => Effect.Effect<LocalCandidateWorkspaceResult>;
  readonly resolveLocalBranch: (cwd: string, ref: string) => Effect.Effect<string | undefined>;
  readonly findComparisonBase: (
    cwd: string,
    targetSha: string,
    headSha: string,
  ) => Effect.Effect<string | undefined>;
  readonly localBranchExists: (cwd: string, ref: string) => Effect.Effect<boolean>;
  readonly recordedRemoteDefaultLocalBranches: (
    cwd: string,
  ) => Effect.Effect<readonly string[] | undefined>;
};
