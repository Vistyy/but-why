import type { RemoteChangeBaseError } from "../submissionEnvironment/remoteChangeBase.js";
import type { ChangeStartRecord } from "./changeStartStore.js";

export type ChangeStartGitIntent = {
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
  readonly startingCommit: string;
  readonly managedWorktreeParent: string;
};

export type ResolveChangeStartGitResult =
  | { readonly ok: true; readonly intent: ChangeStartGitIntent }
  | RemoteChangeBaseError;

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
      readonly code: "managed_branch_missing";
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
  readonly resolveIntent: (requestedBaseBranch?: string) => ResolveChangeStartGitResult;
  readonly provisionWorktree: (
    start: ChangeStartRecord,
    recovering: boolean,
    startingCommit?: string,
  ) => ProvisionChangeWorktreeResult;
};
