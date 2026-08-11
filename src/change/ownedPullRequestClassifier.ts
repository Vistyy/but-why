import type { ChangeOwnedPullRequest, ChangePublication, ChangeRecord } from "./change.js";
import type { GitHubPullRequest, GitHubPullRequestReader } from "./ownedPullRequestGateway.js";

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

export type ObservedMergedChangeEvidence = {
  readonly repository: { readonly owner: string; readonly repo: string };
  readonly pullRequest: ChangeOwnedPullRequest;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly mergedHeadSha: string;
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly expectedHeadSha: string;
};

export const ownedPublication = (change: ChangeRecord): OwnedPublication | undefined => {
  const publication = change.publication;
  return publication?.pullRequest === null || publication === null
    ? undefined
    : (publication as OwnedPublication);
};

export const observedMergedChangeEvidence = (
  change: ChangeRecord,
  pullRequest: GitHubPullRequest,
): ObservedMergedChangeEvidence | undefined => {
  const publication = ownedPublication(change);
  if (publication === undefined) return undefined;
  const repository = pullRequest.repository;
  if (repository === undefined) return undefined;
  return {
    repository,
    pullRequest: { number: pullRequest.number, url: pullRequest.url },
    baseBranch: pullRequest.baseBranch,
    headBranch: pullRequest.headBranch,
    mergedHeadSha: pullRequest.headSha,
    candidateId: publication.candidateId,
    validationRunId: publication.validationRunId,
    expectedHeadSha: publication.expectedHeadSha,
  };
};

export const observeOwnedPullRequest = (
  github: GitHubPullRequestReader,
  change: ChangeRecord,
): OwnedPullRequestClassification => {
  const publication = ownedPublication(change);
  if (publication === undefined) return { kind: "not_owned" };
  try {
    const result = github.getPullRequest(publication.target, publication.pullRequest.number);
    if (!result.ok) {
      return {
        kind: "unavailable",
        reason:
          result.evidence.classification === "response_parse_failure"
            ? "pull_request_facts_unavailable"
            : "pull_request_unavailable",
      };
    }
    return classifyOwnedPullRequest(publication, result.pullRequest);
  } catch {
    return { kind: "unavailable", reason: "github_unavailable" };
  }
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
