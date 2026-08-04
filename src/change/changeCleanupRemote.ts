export type RemoteBranchHeadResult =
  | { readonly state: "missing" }
  | {
      readonly state: "present";
      readonly headSha: string;
      readonly remoteUrl: string;
      readonly repositoryId?: string;
      readonly refId?: string;
    }
  | { readonly state: "unavailable" }
  | { readonly state: "mismatch" }
  | { readonly state: "excluded" };

export type ChangeCleanupRemote = {
  readonly readRemoteBranchHead: (input: {
    readonly repositoryCommonDirectory: string;
    readonly owner: string;
    readonly repo: string;
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly branchName: string;
    readonly canonicalBranchRef: string;
    readonly targetBranch: string;
  }) => RemoteBranchHeadResult;
  readonly deleteRemoteBranch: (input: {
    readonly repositoryCommonDirectory: string;
    readonly owner: string;
    readonly repo: string;
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly branchName: string;
    readonly expectedHeadSha: string;
    readonly resolvedRemoteUrl: string;
    readonly repositoryId?: string;
    readonly refId?: string;
  }) => boolean;
};
