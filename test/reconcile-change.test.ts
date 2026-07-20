import { describe, expect, it } from "vitest";

import { openChangeReconciliation } from "../src/change/reconcileChange.js";
import type { ChangeStore } from "../src/change/changeStore.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
} from "../src/change/ownedPullRequestGateway.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { createSqliteState } from "./support/sqliteState.js";

const now = "2026-07-24T10:00:00.000Z";
const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };

describe("Change reconciliation", () => {
  it("leaves a closed unmerged owned PR and its Change open", () => {
    const fixture = publishedChange();
    const reconciliation = reconciler(fixture.store, {
      ...expectedPullRequest(),
      state: "closed",
      merged: false,
    });

    expect(
      reconciliation.reconcile({
        repositoryCommonDirectory: "/repos/example/.git",
        changeId: fixture.changeId,
        now,
      }),
    ).toEqual({
      rejected: false,
      changes: [
        {
          changeId: fixture.changeId,
          status: "closed_unmerged",
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        },
      ],
    });
    expect(fixture.store.getChangeById(fixture.changeId)).toMatchObject({ state: "open" });
  });

  it("rejects unexpected repository, base, branch, and head facts without adopting them", () => {
    const unexpectedFacts: readonly [GitHubPullRequest, string][] = [
      [
        { ...expectedPullRequest(), repository: { owner: "other", repo: "widgets" } },
        "repository_mismatch",
      ],
      [{ ...expectedPullRequest(), baseBranch: "release" }, "base_branch_mismatch"],
      [{ ...expectedPullRequest(), headBranch: "other-feature" }, "head_branch_mismatch"],
      [{ ...expectedPullRequest(), headSha: "unexpected-head" }, "head_sha_mismatch"],
    ];

    for (const [pullRequest, rejection] of unexpectedFacts) {
      const fixture = publishedChange();
      const reconciliation = reconciler(fixture.store, pullRequest);

      expect(
        reconciliation.reconcile({
          repositoryCommonDirectory: "/repos/example/.git",
          changeId: fixture.changeId,
          now,
        }),
      ).toEqual({
        rejected: true,
        changes: [{ changeId: fixture.changeId, status: "rejected", rejection }],
      });
      expect(fixture.store.getChangeById(fixture.changeId)).toMatchObject({ state: "open" });
    }
  });
});

const publishedChange = () => {
  const store = openSqliteChangeStore(createSqliteState());
  const created = store.createChange({
    repositoryCommonDirectory: "/repos/example/.git",
    branchRef: "refs/heads/feature",
    now,
  });
  if (!created.ok) throw new Error("Could not create Change");
  expect(
    store.beginPublication({
      changeId: created.change.id,
      candidateId: "candidate-1",
      validationRunId: "validation-run-1",
      target,
      headBranch: "feature",
      expectedHeadSha: "expected-head",
      now,
    }).ok,
  ).toBe(true);
  expect(
    store.recordPublishedPullRequest({
      changeId: created.change.id,
      candidateId: "candidate-1",
      validationRunId: "validation-run-1",
      target,
      headBranch: "feature",
      expectedHeadSha: "expected-head",
      pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
      now,
    }).ok,
  ).toBe(true);
  return { store, changeId: created.change.id };
};

const reconciler = (store: ChangeStore, pullRequest: GitHubPullRequest) =>
  openChangeReconciliation({
    changeStore: store,
    github: {
      findPullRequests: () => [],
      getPullRequest: () => pullRequest,
      createPullRequest: () => {
        throw new Error("Reconciliation must not create a pull request");
      },
      updatePullRequest: () => {
        throw new Error("Reconciliation must not update a pull request");
      },
    } satisfies GitHubPullRequestGateway,
    cleanup: () => {
      throw new Error("Open Changes must not be cleaned");
    },
  });

const expectedPullRequest = () => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  repository: { owner: "acme", repo: "widgets" },
  state: "open" as const,
  merged: false,
  baseBranch: "main",
  headBranch: "feature",
  headSha: "expected-head",
});
