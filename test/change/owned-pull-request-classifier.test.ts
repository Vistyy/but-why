import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import {
  classifyOwnedPullRequest,
  type OwnedPublication,
} from "../../src/change/ownedPullRequestClassifier.js";
import type { GitHubPullRequest } from "../../src/change/ownedPullRequestGateway.js";

const publication: OwnedPublication = {
  candidateId: "candidate-1",
  validationRunId: "run-1",
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
  ])("rejects a mismatched $name fact", ({ fact, rejection }) => {
    expect(classifyOwnedPullRequest(publication, fact)).toEqual({
      kind: "mismatch",
      rejection,
      pullRequest: fact,
    });
  });

  it.each([
    {
      name: "missing state",
      fact: ({ state: _state, ...value }: GitHubPullRequest) => value,
    },
    {
      name: "missing merged fact",
      fact: ({ merged: _merged, ...value }: GitHubPullRequest) => value,
    },
  ])("reports unavailable facts when $name", ({ fact }) => {
    expect(classifyOwnedPullRequest(publication, fact(observed()))).toEqual({
      kind: "unavailable",
      reason: "pull_request_facts_unavailable",
    });
  });
});
