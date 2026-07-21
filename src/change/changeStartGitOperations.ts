import type { ChangeStartRecord } from "./changeStartStore.js";

export type ChangeStartGitIntent = {
  readonly repositoryCommonDirectory: string;
  readonly baseRef: string;
  readonly branchRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
};

export type ResolveChangeStartGitResult =
  | { readonly ok: true; readonly intent: ChangeStartGitIntent }
  | {
      readonly ok: false;
      readonly code:
        | "local_default_branch_missing"
        | "local_default_branch_ambiguous"
        | "local_default_branch_unavailable"
        | "committed_repo_config_missing"
        | "committed_repo_config_invalid"
        | "change_start_conflict";
    };

export type ProvisionChangeWorktreeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "change_start_conflict" | "git_tooling_error" };

export type ChangeStartGitOperations = {
  readonly resolveIntent: (slug: string) => ResolveChangeStartGitResult;
  readonly provisionWorktree: (
    start: ChangeStartRecord,
    recovering: boolean,
  ) => ProvisionChangeWorktreeResult;
};
