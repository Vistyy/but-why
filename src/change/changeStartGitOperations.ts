import type { RemoteChangeBaseError } from "../submissionEnvironment/remoteChangeBase.js";
import type { ChangeStartRecord } from "./changeStartStore.js";

export type ChangeStartGitIntent = {
  readonly repositoryCommonDirectory: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly branchRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
  readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
};

export type ResolveChangeStartGitResult =
  | { readonly ok: true; readonly intent: ChangeStartGitIntent }
  | RemoteChangeBaseError
  | {
      readonly ok: false;
      readonly code:
        | "committed_repo_config_missing"
        | "committed_repo_config_invalid"
        | "change_start_conflict"
        | "requested_base_conflict";
      readonly requestedBaseBranch?: string;
      readonly recordedBaseBranch?: string;
    };

export type ProvisionChangeWorktreeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "change_start_conflict" | "git_tooling_error" }
  | {
      readonly ok: false;
      readonly code: "managed_worktree_path_unavailable";
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly code: "managed_worktree_path_conflict";
      readonly branch: string;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly code: "managed_branch_attached";
      readonly branch: string;
      readonly path: string;
      readonly attachedPath: string;
    };

export type ProvisionChangeWorktreeFailure = Exclude<
  ProvisionChangeWorktreeResult,
  { readonly ok: true }
>;

export type ChangeStartGitOperations = {
  readonly resolveIntent: (
    slug: string,
    requestedBaseBranch?: string,
  ) => ResolveChangeStartGitResult;
  readonly provisionWorktree: (
    start: ChangeStartRecord,
    recovering: boolean,
  ) => ProvisionChangeWorktreeResult;
};
