import { describe, expect, it } from "vitest";

import { localGitHubPullRequestGateway } from "../../src/submissionEnvironment/localGitHubPullRequestGateway.js";

describe("GitHub pull request gateway", () => {
  it("pushes the exact Candidate SHA before creating the pull request", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout: args[0] === "rev-parse" ? "candidate-sha\n" : "",
        };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            '{"number":42,"url":"https://github.com/acme/widgets/pull/42","base":{"ref":"main"},"head":{"ref":"feature","sha":"candidate-sha"}}',
        };
      },
    });

    expect(
      gateway.createPullRequest({
        owner: "acme",
        repo: "widgets",
        remoteName: "origin",
        baseBranch: "main",
        headBranch: "feature",
        branchRef: "refs/heads/feature",
        expectedHeadSha: "candidate-sha",
        title: "Publish Candidate",
        body: "Validation facts",
      }),
    ).toEqual({
      ok: true,
      pullRequest: {
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        baseBranch: "main",
        headBranch: "feature",
        headSha: "candidate-sha",
      },
    });
    expect(gitCalls).toEqual([
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
      ["ls-remote", "--heads", "origin", "refs/heads/feature"],
      [
        "push",
        "--force-with-lease=refs/heads/feature:",
        "origin",
        "candidate-sha:refs/heads/feature",
      ],
    ]);
    expect(ghCalls).toEqual([
      [
        "api",
        "--method",
        "POST",
        "repos/acme/widgets/pulls",
        "-f",
        "title=Publish Candidate",
        "-f",
        "head=feature",
        "-f",
        "base=main",
        "-f",
        "body=Validation facts",
      ],
    ]);
  });

  it("reads authoritative repository and lifecycle facts for an owned pull request", () => {
    const gateway = localGitHubPullRequestGateway({
      runGh: () => ({
        ok: true,
        stdout:
          '{"number":42,"url":"https://github.com/acme/widgets/pull/42","state":"closed","merged":true,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
      }),
    });

    expect(
      gateway.getPullRequest(
        { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        42,
      ),
    ).toEqual({
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      state: "closed",
      merged: true,
      repository: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
      headBranch: "feature",
      headSha: "candidate-sha",
    });
  });

  it("rejects an existing remote head before initial publication", () => {
    const gitCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout: args[0] === "rev-parse" ? "candidate-sha\n" : "other-head\trefs/heads/feature\n",
        };
      },
      runGh: () => {
        throw new Error("Must not create a PR from an existing remote head");
      },
    });

    expect(
      gateway.createPullRequest({
        owner: "acme",
        repo: "widgets",
        remoteName: "origin",
        baseBranch: "main",
        headBranch: "feature",
        branchRef: "refs/heads/feature",
        expectedHeadSha: "candidate-sha",
        title: "Publish Candidate",
        body: "Validation facts",
      }),
    ).toEqual({ ok: false, code: "remote_head_mismatch" });
    expect(gitCalls).toEqual([
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
      ["ls-remote", "--heads", "origin", "refs/heads/feature"],
    ]);
  });

  it("checks the local branch immediately before pushing an exact Candidate", () => {
    const gitCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return { ok: true, stdout: "newer-head\n" };
      },
      runGh: () => {
        throw new Error("Must not mutate GitHub from a moved branch");
      },
    });

    expect(
      gateway.createPullRequest({
        owner: "acme",
        repo: "widgets",
        remoteName: "origin",
        baseBranch: "main",
        headBranch: "feature",
        branchRef: "refs/heads/feature",
        expectedHeadSha: "candidate-sha",
        title: "Publish Candidate",
        body: "Validation facts",
      }),
    ).toEqual({ ok: false, code: "local_head_mismatch" });
    expect(
      gateway.updatePullRequest({
        owner: "acme",
        repo: "widgets",
        remoteName: "origin",
        baseBranch: "main",
        headBranch: "feature",
        branchRef: "refs/heads/feature",
        expectedHeadSha: "candidate-sha",
        expectedCurrentHeadSha: "previous-candidate-sha",
        number: 42,
        title: "Publish Candidate",
        body: "Validation facts",
      }),
    ).toEqual({ ok: false, code: "local_head_mismatch" });
    expect(gitCalls).toEqual([
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
    ]);
  });
});
