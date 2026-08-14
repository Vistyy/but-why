import type { ChangeOwnedPullRequest, ChangePublicationTarget } from "./change.js";

export type GitHubPullRequest = ChangeOwnedPullRequest & {
  readonly repository: { readonly owner: string; readonly repo: string };
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly title?: string;
  readonly body?: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
};

export type PublicationFailureEvidence = {
  readonly operation:
    | "remote_lookup"
    | "push_destination"
    | "branch_push"
    | "pull_request_creation"
    | "pull_request_update"
    | "pull_request_close";
  readonly classification:
    | "rejected"
    | "lost_response"
    | "response_parse_failure"
    | "unavailable"
    | "conflict";
  readonly reason?:
    | "unavailable"
    | "destination_count"
    | "credentials"
    | "malformed"
    | "repository_mismatch"
    | "postcondition_mismatch";
  readonly destinationCount?: number;
  readonly destinationOwner?: string;
  readonly destinationRepo?: string;
  readonly exitStatus?: number;
};

export type GitHubPullRequestCoordinates = {
  readonly owner: string;
  readonly repo: string;
  readonly remoteName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly branchRef: string;
  readonly expectedHeadSha: string;
  readonly allowExistingRemoteHead?: boolean;
};

export type GitHubPullRequestMutationRequest = GitHubPullRequestCoordinates & {
  readonly body: string;
};

export type GitHubPullRequestCreationRequest = GitHubPullRequestMutationRequest & {
  readonly title: string;
};

export type GitHubPullRequestUpdateRequest = GitHubPullRequestMutationRequest & {
  readonly number: number;
  readonly expectedCurrentHeadSha: string;
};

export type GitHubPullRequestReadResult =
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | { readonly ok: false; readonly evidence: PublicationFailureEvidence };

export type GitHubPullRequestListResult =
  | { readonly ok: true; readonly pullRequests: readonly GitHubPullRequest[] }
  | { readonly ok: false; readonly evidence: PublicationFailureEvidence };

export type GitHubPullRequestMutationResult =
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | {
      readonly ok: false;
      readonly code:
        | "local_head_mismatch"
        | "remote_head_mismatch"
        | "push_destination_failed"
        | "push_failed"
        | "remote_lookup_failed"
        | "remote_response_lost"
        | "remote_response_unusable"
        | "remote_rejected"
        | "close_failed";
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
      readonly observedRemoteHeadSha?: string;
    };

export type GitHubPullRequestCloseInput = {
  readonly target: ChangePublicationTarget;
  readonly number: number;
};

export type GitHubPullRequestReader = {
  readonly getPullRequest: (
    target: ChangePublicationTarget,
    number: number,
  ) => GitHubPullRequestReadResult;
};

export type GitHubPullRequestCloser = GitHubPullRequestReader & {
  readonly closePullRequest: (
    input: GitHubPullRequestCloseInput,
  ) => GitHubPullRequestMutationResult;
};

export type GitHubPullRequestGateway = GitHubPullRequestReader & {
  readonly findPullRequests: (
    target: ChangePublicationTarget,
    headBranch: string,
  ) => GitHubPullRequestListResult;
  readonly createPullRequest: (
    request: GitHubPullRequestCreationRequest,
  ) => GitHubPullRequestMutationResult;
  readonly updatePullRequest: (
    input: GitHubPullRequestUpdateRequest,
  ) => GitHubPullRequestMutationResult;
};
