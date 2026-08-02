import type { ChangeOwnedPullRequest, ChangePublicationTarget } from "./change.js";

export type GitHubPullRequest = ChangeOwnedPullRequest & {
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly state?: "open" | "closed";
  readonly merged?: boolean;
  readonly repository?: { readonly owner: string; readonly repo: string };
};

export type PublicationFailureEvidence = {
  readonly operation:
    | "remote_lookup"
    | "branch_push"
    | "pull_request_creation"
    | "pull_request_update";
  readonly classification: "rejected" | "lost_response" | "response_parse_failure" | "unavailable";
  readonly exitStatus?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly parseFailure?: string;
};

export type GitHubPullRequestRequest = {
  readonly owner: string;
  readonly repo: string;
  readonly remoteName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly branchRef: string;
  readonly expectedHeadSha: string;
  readonly allowExistingRemoteHead?: boolean;
  readonly title: string;
  readonly body: string;
};

export type GitHubPullRequestMutationResult =
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | {
      readonly ok: false;
      readonly code:
        | "local_head_mismatch"
        | "remote_head_mismatch"
        | "push_failed"
        | "remote_response_lost"
        | "remote_response_unusable"
        | "remote_rejected"
        | "close_failed";
      readonly evidence?: PublicationFailureEvidence;
      readonly observedRemoteHeadSha?: string;
    };

export type GitHubPullRequestCloseInput = {
  readonly target: ChangePublicationTarget;
  readonly number: number;
};

export type GitHubPullRequestGateway = {
  readonly findPullRequests: (
    target: ChangePublicationTarget,
    headBranch: string,
  ) => readonly GitHubPullRequest[] | undefined;
  readonly getPullRequest: (
    target: ChangePublicationTarget,
    number: number,
  ) => GitHubPullRequest | undefined;
  readonly closePullRequest?: (
    input: GitHubPullRequestCloseInput,
  ) => GitHubPullRequestMutationResult;
  readonly createPullRequest: (
    request: GitHubPullRequestRequest,
  ) => GitHubPullRequestMutationResult;
  readonly updatePullRequest: (
    input: GitHubPullRequestRequest & {
      readonly number: number;
      readonly expectedCurrentHeadSha: string;
    },
  ) => GitHubPullRequestMutationResult;
};
