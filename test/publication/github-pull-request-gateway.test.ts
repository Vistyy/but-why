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
            '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":"https://github.com/acme/widgets/pull/42","base":{"ref":"main"},"head":{"ref":"feature","sha":"candidate-sha"}}',
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

  it("returns a stale update response after pushing the exact Candidate", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return { ok: true, stdout: args[0] === "rev-parse" ? "candidate-sha\n" : "" };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":"not-a-url","base":{"ref":"main"},"head":{"ref":"feature","sha":"previous-candidate-sha"}}',
        };
      },
    });

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
    ).toMatchObject({
      ok: true,
      pullRequest: {
        headSha: "previous-candidate-sha",
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
      },
    });
    expect(gitCalls).toEqual([
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
      [
        "push",
        "--force-with-lease=refs/heads/feature:previous-candidate-sha",
        "origin",
        "candidate-sha:refs/heads/feature",
      ],
    ]);
    expect(ghCalls).toEqual([
      [
        "api",
        "--method",
        "PATCH",
        "repos/acme/widgets/pulls/42",
        "-f",
        "title=Publish Candidate",
        "-f",
        "body=Validation facts",
      ],
    ]);
  });

  it("reads complete unmerged facts from GitHub pull request lists", () => {
    const gateway = localGitHubPullRequestGateway({
      runGh: () => ({
        ok: true,
        stdout:
          '[{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","state":"open","merged_at":null,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}]',
      }),
    });

    expect(
      gateway.findPullRequests(
        { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        "feature",
      ),
    ).toEqual([
      {
        number: 42,
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
        state: "open",
        merged: false,
        repository: { owner: "acme", repo: "widgets" },
        baseBranch: "main",
        headBranch: "feature",
        headSha: "candidate-sha",
      },
    ]);
  });

  it("reads authoritative repository and lifecycle facts for an owned pull request", () => {
    const gateway = localGitHubPullRequestGateway({
      runGh: () => ({
        ok: true,
        stdout:
          '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":null,"state":"closed","merged":true,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
      }),
    });

    expect(
      gateway.getPullRequest(
        { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        42,
      ),
    ).toEqual({
      number: 42,
      url: "https://api.github.com/repos/acme/widgets/pulls/42",
      state: "closed",
      merged: true,
      repository: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
      headBranch: "feature",
      headSha: "candidate-sha",
    });
  });

  it("closes an owned pull request through GitHub", () => {
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","state":"closed","merged":false,"base":{"ref":"main"},"head":{"ref":"feature","sha":"candidate-sha"}}',
        };
      },
    });

    expect(
      gateway.closePullRequest?.({
        target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        number: 42,
      }),
    ).toMatchObject({
      ok: true,
      pullRequest: {
        state: "closed",
        merged: false,
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
      },
    });
    expect(ghCalls).toEqual([
      ["api", "--method", "PATCH", "repos/acme/widgets/pulls/42", "-f", "state=closed"],
    ]);
  });

  it("reports a GitHub closure failure without claiming local cancellation", () => {
    const gateway = localGitHubPullRequestGateway({ runGh: () => ({ ok: false }) });

    expect(
      gateway.closePullRequest?.({
        target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        number: 42,
      }),
    ).toEqual({ ok: false, code: "close_failed" });
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
    ).toEqual({ ok: false, code: "remote_head_mismatch", observedRemoteHeadSha: "other-head" });
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

  it("keeps a failed remote branch lookup distinct from a failed push", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) =>
        args[0] === "rev-parse"
          ? { ok: true, stdout: "candidate-sha\n" }
          : { ok: false, status: 128, stderr: "remote unavailable" },
      runGh: () => ({ ok: true, stdout: "" }),
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
        title: "Publish",
        body: "Body",
      }),
    ).toMatchObject({
      ok: false,
      code: "remote_lookup_failed",
      evidence: { operation: "remote_lookup", classification: "rejected" },
    });
  });

  it("accepts an exact existing remote branch during recovery without pushing again", () => {
    const gitCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse" ? "candidate-sha\n" : "candidate-sha\trefs/heads/feature\n",
        };
      },
      runGh: () => ({
        ok: true,
        stdout:
          '{"number":42,"url":"https://github.com/acme/widgets/pull/42","base":{"ref":"main"},"head":{"ref":"feature","sha":"candidate-sha"}}',
      }),
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
        allowExistingRemoteHead: true,
        title: "Publish",
        body: "Body",
      }),
    ).toMatchObject({ ok: true });
    expect(gitCalls.map((call) => call[0])).toEqual(["rev-parse", "ls-remote"]);
  });

  it("reports failed pushes and bounds command evidence", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        if (args[0] === "rev-parse") return { ok: true, stdout: "candidate-sha\n" };
        if (args[0] === "ls-remote") return { ok: true, stdout: "" };
        return { ok: false, status: 1, stderr: "x".repeat(2000) };
      },
      runGh: () => ({ ok: true, stdout: "" }),
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
        title: "Publish",
        body: "Body",
      }),
    ).toMatchObject({
      ok: false,
      code: "push_failed",
      evidence: { operation: "branch_push", exitStatus: 1, stderr: expect.any(String) },
    });
    const result = gateway.createPullRequest({
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      baseBranch: "main",
      headBranch: "feature",
      branchRef: "refs/heads/feature",
      expectedHeadSha: "candidate-sha",
      title: "Publish",
      body: "Body",
    });
    if (result.ok) throw new Error("Expected push failure evidence");
    expect(result.evidence?.stderr?.length).toBeLessThanOrEqual(1000);
  });

  it("classifies lost and unusable creation responses", () => {
    const request = {
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      baseBranch: "main",
      headBranch: "feature",
      branchRef: "refs/heads/feature",
      expectedHeadSha: "candidate-sha",
      title: "Publish",
      body: "Body",
    };
    for (const [response, classification] of [
      [{ ok: false as const }, "lost_response" as const],
      [{ ok: true as const, stdout: "not-json" }, "response_parse_failure" as const],
    ] as const) {
      const gateway = localGitHubPullRequestGateway({
        runGit: (args) => ({ ok: true, stdout: args[0] === "rev-parse" ? "candidate-sha\n" : "" }),
        runGh: () => response,
      });
      expect(gateway.createPullRequest(request)).toMatchObject({
        ok: false,
        evidence: { operation: "pull_request_creation", classification },
      });
    }
  });

  it("returns bounded redacted evidence for a rejected creation", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => ({ ok: true, stdout: args[0] === "rev-parse" ? "candidate-sha\n" : "" }),
      runGh: (args) =>
        args[1] === "--method"
          ? {
              ok: false,
              status: 422,
              stdout: "token=SECRET",
              stderr: "Authorization:\nBearer SECRET",
            }
          : { ok: true, stdout: "" },
    });
    const result = gateway.createPullRequest({
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      baseBranch: "main",
      headBranch: "feature",
      branchRef: "refs/heads/feature",
      expectedHeadSha: "candidate-sha",
      title: "Publish",
      body: "Body",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "remote_rejected",
      evidence: { operation: "pull_request_creation", classification: "rejected", exitStatus: 422 },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
