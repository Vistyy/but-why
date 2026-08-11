export type RemoteChangeBase = {
  readonly remoteName: string;
  readonly branchName: string;
  readonly remoteUrl: string;
  readonly ref: string;
  readonly commit: string;
};

export type RemoteChangeBaseError =
  | { readonly ok: false; readonly code: "publication_remote_missing" }
  | {
      readonly ok: false;
      readonly code: "publication_remote_ambiguous";
      readonly remoteNames: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "publication_remote_unreachable";
      readonly remoteName: string;
    }
  | {
      readonly ok: false;
      readonly code: "remote_default_branch_missing";
      readonly remoteName: string;
    }
  | {
      readonly ok: false;
      readonly code: "remote_branch_missing";
      readonly remoteName: string;
      readonly branchName: string;
    }
  | { readonly ok: false; readonly code: "invalid_remote_change_base"; readonly baseRef: string }
  | {
      readonly ok: false;
      readonly code: "publication_remote_changed";
      readonly remoteName: string;
      readonly expectedRemoteUrl: string;
      readonly actualRemoteUrl: string;
    };

export type RemoteChangeBaseResult =
  | { readonly ok: true; readonly base: RemoteChangeBase }
  | RemoteChangeBaseError;
