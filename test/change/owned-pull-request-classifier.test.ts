import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import type { ChangePublication, ChangeRecord } from "../../src/change/change.js";
import {
  classifyOwnedPullRequest,
  type OwnedPublication,
  observeOwnedPullRequest,
} from "../../src/change/ownedPullRequestClassifier.js";
import type { GitHubPullRequest } from "../../src/change/ownedPullRequestGateway.js";

const publication: OwnedPublication = {
  candidateId: 1,
  validationRunId: 1,
  target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
  headBranch: "change-1",
  expectedHeadSha: "published-head",
  pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
};

const observed = (overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  number: 42,
  url: "https://github.test/acme/repo/pull/42",
  repository: { owner: "acme", repo: "repo" },
  state: "open",
  merged: false,
  baseBranch: "main",
  headBranch: "change-1",
  headSha: "published-head",
  ...overrides,
});

describe("owned pull request classifier", () => {
  it("classifies the exact open owned pull request", () => {
    expect(classifyOwnedPullRequest(publication, observed())).toEqual({
      kind: "exact_open",
      pullRequest: observed(),
    });
  });

  it("classifies an exact closed-unmerged owned pull request", () => {
    expect(
      classifyOwnedPullRequest(publication, observed({ state: "closed", merged: false })),
    ).toEqual({
      kind: "exact_closed_unmerged",
      pullRequest: observed({ state: "closed", merged: false }),
    });
  });

  it("classifies an exact merged owned pull request", () => {
    expect(
      classifyOwnedPullRequest(publication, observed({ state: "closed", merged: true })),
    ).toEqual({
      kind: "exact_merged",
      pullRequest: observed({ state: "closed", merged: true }),
    });
  });

  it.each([
    {
      name: "number",
      fact: observed({ number: 43 }),
      rejection: "number_mismatch",
    },
    {
      name: "repository",
      fact: observed({ repository: { owner: "other", repo: "repo" } }),
      rejection: "repository_mismatch",
    },
    {
      name: "base branch",
      fact: observed({ baseBranch: "release" }),
      rejection: "base_branch_mismatch",
    },
    {
      name: "head branch",
      fact: observed({ headBranch: "other-change" }),
      rejection: "head_branch_mismatch",
    },
    {
      name: "open head commit",
      fact: observed({ headSha: "unexpected-head" }),
      rejection: "head_sha_mismatch",
    },
    {
      name: "closed-unmerged head commit",
      fact: observed({ state: "closed", merged: false, headSha: "unexpected-head" }),
      rejection: "closed_unmerged_head_sha_mismatch",
    },
    {
      name: "merged head commit",
      fact: observed({ state: "closed", merged: true, headSha: "unexpected-head" }),
      rejection: "merged_head_mismatch",
    },
    {
      name: "impossible open merged state",
      fact: observed({ state: "open", merged: true }),
      rejection: "pull_request_state_invalid",
    },
    {
      name: "impossible open merged state with unexpected head",
      fact: observed({ state: "open", merged: true, headSha: "unexpected-head" }),
      rejection: "merged_head_mismatch",
    },
  ])("rejects a mismatched $name fact", ({ fact, rejection }) => {
    expect(classifyOwnedPullRequest(publication, fact)).toEqual({
      kind: "mismatch",
      rejection,
      pullRequest: fact,
    });
  });
});

describe("owned pull request observation", () => {
  const change = (publication: ChangePublication | null): ChangeRecord => ({
    id: "change-1",
    repositoryCommonDirectory: "/repo/.git",
    branchRef: "refs/heads/change-1",
    baseRef: "refs/remotes/origin/main",
    baseRemoteUrl: "https://github.com/acme/repo.git",
    worktreePath: "/repo",
    acceptanceContext: null,
    reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
    checks: [],
    prepare: null,
    prepareFailure: null,
    publication,
    implementationDecisions: [],
    activeBlocker: null,
    cleanup: { state: "complete", blockingReason: null },
    state: "open",
    closeReason: null,
    cancelReason: null,
  });

  it("reports not owned only when no owned pull request facts exist", () => {
    expect(
      observeOwnedPullRequest(
        {
          getPullRequest: () => {
            throw new Error("No owned pull request must be observed");
          },
        },
        change(null),
      ),
    ).toEqual({ kind: "not_owned" });
  });

  it("classifies a vanished owned pull request as unavailable, never not owned", () => {
    expect(
      observeOwnedPullRequest(
        {
          getPullRequest: () => ({
            ok: false,
            evidence: { operation: "remote_lookup", classification: "unavailable" },
          }),
        },
        change(publication),
      ),
    ).toEqual({ kind: "unavailable", reason: "pull_request_unavailable" });
  });

  it("classifies malformed owned pull request facts as unavailable, never mismatch", () => {
    expect(
      observeOwnedPullRequest(
        {
          getPullRequest: () => ({
            ok: false,
            evidence: {
              operation: "remote_lookup",
              classification: "response_parse_failure",
            },
          }),
        },
        change(publication),
      ),
    ).toEqual({ kind: "unavailable", reason: "pull_request_facts_unavailable" });
  });

  it("classifies an unreadable owned pull request as unavailable, never not owned", () => {
    expect(
      observeOwnedPullRequest(
        {
          getPullRequest: () => {
            throw new Error("remote read failed");
          },
        },
        change(publication),
      ),
    ).toEqual({ kind: "unavailable", reason: "github_unavailable" });
  });
});
