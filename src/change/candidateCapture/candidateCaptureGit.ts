import type { Effect } from "effect";

export type LocalCandidateWorkspace = {
  readonly repositoryCommonDirectory: string;
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

export type RepositoryBranchHeadResult =
  | { readonly ok: true; readonly headSha: string }
  | {
      readonly ok: false;
      readonly code:
        | "detached_head"
        | "unborn_branch"
        | "conflicting_branch_facts"
        | "git_tooling_error";
    };

export type CandidateCaptureGit = {
  readonly readWorkspace: (cwd: string) => Effect.Effect<LocalCandidateWorkspaceResult>;
  readonly resolveLocalBranch: (cwd: string, ref: string) => Effect.Effect<string | undefined>;
  readonly containsCommit: (
    cwd: string,
    ancestorSha: string,
    headSha: string,
  ) => Effect.Effect<boolean | undefined>;
  readonly trackedTreeMatches: (
    cwd: string,
    commitSha: string,
  ) => Effect.Effect<boolean | undefined>;
  readonly localBranchExists: (cwd: string, ref: string) => Effect.Effect<boolean>;
  readonly recordedRemoteDefaultLocalBranches: (
    cwd: string,
  ) => Effect.Effect<readonly string[] | undefined>;
};
