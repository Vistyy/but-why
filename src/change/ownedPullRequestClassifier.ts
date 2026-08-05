import type { ChangePublication, ChangeRecord } from "./change.js";
import type { GitHubPullRequest, GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";

export type OwnedPullRequestRejection =
  | "number_mismatch"
  | "repository_mismatch"
  | "base_branch_mismatch"
  | "head_branch_mismatch"
  | "merged_head_mismatch"
  | "pull_request_state_invalid"
  | "head_sha_mismatch"
  | "closed_unmerged_head_sha_mismatch";

export type OwnedPullRequestUnavailableReason =
  | "github_unavailable"
  | "pull_request_unavailable"
  | "pull_request_facts_unavailable";

export type OwnedPullRequestClassification =
  | { readonly kind: "not_owned" }
  | { readonly kind: "exact_open"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "exact_closed_unmerged"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "exact_merged"; readonly pullRequest: GitHubPullRequest }
  | {
      readonly kind: "mismatch";
      readonly rejection: OwnedPullRequestRejection;
      readonly pullRequest: GitHubPullRequest;
    }
  | { readonly kind: "unavailable"; readonly reason: OwnedPullRequestUnavailableReason };

export type OwnedPublication = ChangePublication & {
  readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
};

const ownedPublication = (change: ChangeRecord): OwnedPublication | undefined => {
  const publication = change.publication;
  return publication?.pullRequest === null || publication === null
    ? undefined
    : (publication as OwnedPublication);
};

export const observeOwnedPullRequest = (
  github: GitHubPullRequestGateway,
  change: ChangeRecord,
): OwnedPullRequestClassification => {
  const publication = ownedPublication(change);
  if (publication === undefined) return { kind: "not_owned" };
  let pullRequest: GitHubPullRequest | undefined;
  try {
    pullRequest = github.getPullRequest(publication.target, publication.pullRequest.number);
  } catch {
    return { kind: "unavailable", reason: "github_unavailable" };
  }
  if (pullRequest === undefined) {
    return { kind: "unavailable", reason: "pull_request_unavailable" };
  }
  return classifyOwnedPullRequest(publication, pullRequest);
};

export const classifyOwnedPullRequest = (
  publication: OwnedPublication,
  pullRequest: GitHubPullRequest,
): OwnedPullRequestClassification => {
  if (pullRequest.number !== publication.pullRequest.number) {
    return { kind: "mismatch", rejection: "number_mismatch", pullRequest };
  }
  const repository = pullRequest.repository;
  if (
    repository === undefined ||
    repository.owner !== publication.target.owner ||
    repository.repo !== publication.target.repo
  ) {
    return { kind: "mismatch", rejection: "repository_mismatch", pullRequest };
  }
  if (pullRequest.baseBranch !== publication.target.baseBranch) {
    return { kind: "mismatch", rejection: "base_branch_mismatch", pullRequest };
  }
  if (pullRequest.headBranch !== publication.headBranch) {
    return { kind: "mismatch", rejection: "head_branch_mismatch", pullRequest };
  }
  if (pullRequest.merged === true && pullRequest.headSha !== publication.expectedHeadSha) {
    return { kind: "mismatch", rejection: "merged_head_mismatch", pullRequest };
  }
  if (pullRequest.state === undefined || pullRequest.merged === undefined) {
    return { kind: "unavailable", reason: "pull_request_facts_unavailable" };
  }
  const state = `${pullRequest.state}:${String(pullRequest.merged)}`;
  if (state !== "open:false" && state !== "closed:false" && state !== "closed:true") {
    return { kind: "mismatch", rejection: "pull_request_state_invalid", pullRequest };
  }
  if (pullRequest.headSha !== publication.expectedHeadSha && state !== "closed:true") {
    return {
      kind: "mismatch",
      rejection:
        state === "closed:false" ? "closed_unmerged_head_sha_mismatch" : "head_sha_mismatch",
      pullRequest,
    };
  }
  if (state === "open:false") {
    return { kind: "exact_open", pullRequest };
  }
  if (state === "closed:false") {
    return { kind: "exact_closed_unmerged", pullRequest };
  }
  return { kind: "exact_merged", pullRequest };
};
