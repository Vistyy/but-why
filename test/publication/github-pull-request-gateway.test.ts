import { describe, expect, it } from "vitest";

import {
  localGitHubChangeCleanupRemote,
  localGitHubPullRequestGateway,
} from "../../src/submissionEnvironment/adapters/localGitHubPullRequestGateway.js";

const remoteHeadResponse = (sha?: string): string =>
  JSON.stringify({
    data: {
      repository: {
        unknown: true,
        ref:
          sha === undefined
            ? null
            : {
                name: "feature",
                prefix: "refs/heads/",
                target: { oid: sha, unknown: true },
                unknown: true,
              },
      },
      unknown: true,
    },
    unknown: true,
  });

describe("GitHub pull request gateway", () => {
  it("pushes the exact Candidate SHA before creating the pull request", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? "candidate-sha\n"
              : args[0] === "remote"
                ? "https://github.com/acme/widgets.git\n"
                : "",
        };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            args[1] === "graphql"
              ? remoteHeadResponse()
              : '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":"https://github.com/acme/widgets/pull/42","state":"open","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
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
        repository: { owner: "acme", repo: "widgets" },
        state: "open",
        merged: false,
        baseBranch: "main",
        headBranch: "feature",
        headSha: "candidate-sha",
      },
    });
    expect(gitCalls).toEqual([
      ["rev-parse", "--verify", "refs/heads/feature^{commit}"],
      ["remote", "get-url", "--push", "--all", "origin"],
      [
        "-c",
        "url.https://github.com/acme/widgets.git.pushInsteadOf=https://github.com/acme/widgets.git",
        "push",
        "--force-with-lease=refs/heads/feature:",
        "https://github.com/acme/widgets.git",
        "candidate-sha:refs/heads/feature",
      ],
    ]);
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls[0]).toContain("qualifiedName=refs/heads/feature");
    expect(ghCalls[1]).toEqual([
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
    ]);
  });

  it("returns a stale update response after pushing the exact Candidate", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? "candidate-sha\n"
              : args[0] === "remote"
                ? "git@github.com:acme/widgets.git\n"
                : "",
        };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":"not-a-url","state":"open","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"previous-candidate-sha"}}',
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
      ["remote", "get-url", "--push", "--all", "origin"],
      [
        "-c",
        "url.git@github.com:acme/widgets.git.pushInsteadOf=git@github.com:acme/widgets.git",
        "push",
        "--force-with-lease=refs/heads/feature:previous-candidate-sha",
        "git@github.com:acme/widgets.git",
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
        "state=open",
        "-f",
        "title=Publish Candidate",
        "-f",
        "body=Validation facts",
      ],
    ]);
  });

  it("updates pull request metadata without pushing when the Remote Change Branch is exact", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return { ok: true, stdout: "candidate-sha\n" };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            args[1] === "graphql"
              ? remoteHeadResponse("candidate-sha")
              : '{"number":42,"url":"https://github.com/acme/widgets/pull/42","title":"Revised Candidate","body":"Complete decision log","state":"open","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
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
        allowExistingRemoteHead: true,
        number: 42,
        title: "Revised Candidate",
        body: "Complete decision log",
      }),
    ).toMatchObject({
      ok: true,
      pullRequest: {
        headSha: "candidate-sha",
        title: "Revised Candidate",
        body: "Complete decision log",
      },
    });
    expect(gitCalls).toEqual([["rev-parse", "--verify", "refs/heads/feature^{commit}"]]);
    expect(ghCalls).toEqual([
      expect.arrayContaining(["graphql", "qualifiedName=refs/heads/feature"]),
      [
        "api",
        "--method",
        "PATCH",
        "repos/acme/widgets/pulls/42",
        "-f",
        "state=open",
        "-f",
        "title=Revised Candidate",
        "-f",
        "body=Complete decision log",
      ],
    ]);
  });

  it("retains the exact force-with-lease when recovery finds the previously published head", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const candidateHead = "a".repeat(40);
    const publishedHead = "b".repeat(40);
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? `${candidateHead}\n`
              : args[0] === "remote"
                ? "https://github.com/acme/widgets.git\n"
                : "",
        };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            args[1] === "graphql"
              ? remoteHeadResponse(publishedHead)
              : `{"number":42,"url":"https://github.com/acme/widgets/pull/42","state":"open","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"${candidateHead}"}}`,
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
        expectedHeadSha: candidateHead,
        expectedCurrentHeadSha: publishedHead,
        allowExistingRemoteHead: true,
        number: 42,
        title: "Revised Candidate",
        body: "Complete decision log",
      }),
    ).toMatchObject({ ok: true, pullRequest: { headSha: candidateHead } });
    expect(gitCalls).toContainEqual([
      "-c",
      "url.https://github.com/acme/widgets.git.pushInsteadOf=https://github.com/acme/widgets.git",
      "push",
      `--force-with-lease=refs/heads/feature:${publishedHead}`,
      "https://github.com/acme/widgets.git",
      `${candidateHead}:refs/heads/feature`,
    ]);
    expect(ghCalls).toHaveLength(2);
  });

  it("rejects a foreign Remote Change Branch before a recovery update", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const foreignHead = "b".repeat(40);
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return { ok: true, stdout: "candidate-sha\n" };
      },
      runGh: (args) => {
        ghCalls.push(args);
        return { ok: true, stdout: remoteHeadResponse(foreignHead) };
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
        allowExistingRemoteHead: true,
        number: 42,
        title: "Revised Candidate",
        body: "Complete decision log",
      }),
    ).toEqual({
      ok: false,
      code: "remote_head_mismatch",
      observedRemoteHeadSha: foreignHead,
    });
    expect(gitCalls).toEqual([["rev-parse", "--verify", "refs/heads/feature^{commit}"]]);
    expect(ghCalls).toHaveLength(1);
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
    ).toEqual({
      ok: true,
      pullRequests: [
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
      ],
    });
  });

  it("reads authoritative repository and lifecycle facts for an owned pull request", () => {
    const gateway = localGitHubPullRequestGateway({
      runGh: () => ({
        ok: true,
        stdout:
          '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","html_url":null,"title":"Published Candidate","body":null,"state":"closed","merged":true,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
      }),
    });

    expect(
      gateway.getPullRequest(
        { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        42,
      ),
    ).toEqual({
      ok: true,
      pullRequest: {
        number: 42,
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
        state: "closed",
        merged: true,
        repository: { owner: "acme", repo: "widgets" },
        baseBranch: "main",
        headBranch: "feature",
        headSha: "candidate-sha",
        title: "Published Candidate",
        body: "",
      },
    });
  });

  it("tolerates GitHub response expansion without exposing unknown fields", () => {
    const pullRequestGateway = localGitHubPullRequestGateway({
      runGh: () => ({
        ok: true,
        stdout: JSON.stringify({
          number: 42,
          url: "https://api.github.com/repos/acme/widgets/pulls/42",
          state: "open",
          merged: false,
          draft: true,
          base: {
            ref: "main",
            label: "acme:main",
            repo: { owner: { login: "acme", avatar_url: "unknown" }, name: "widgets", id: 1 },
          },
          head: { ref: "feature", sha: "candidate-sha", user: { login: "agent" } },
        }),
      }),
    });

    expect(
      pullRequestGateway.getPullRequest(
        { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        42,
      ),
    ).toEqual({
      ok: true,
      pullRequest: {
        number: 42,
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
        state: "open",
        merged: false,
        repository: { owner: "acme", repo: "widgets" },
        baseBranch: "main",
        headBranch: "feature",
        headSha: "candidate-sha",
      },
    });

    const cleanupGateway = localGitHubChangeCleanupRemote({
      runGh: () => ({
        ok: true,
        stdout: JSON.stringify({
          data: {
            repository: {
              id: "repo-id",
              databaseId: 1,
              defaultBranchRef: { name: "main", unknown: true },
              ref: { id: "ref-id", target: { oid: "candidate-sha", unknown: true } },
            },
          },
          extensions: { requestId: "unknown" },
        }),
      }),
    });
    expect(
      cleanupGateway.readRemoteBranchHead({
        repositoryCommonDirectory: "/repo/.git",
        owner: "acme",
        repo: "widgets",
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/widgets.git",
        branchName: "but-why/feature",
        canonicalBranchRef: "refs/heads/but-why/feature",
        targetBranch: "main",
      }),
    ).toEqual({
      state: "present",
      headSha: "candidate-sha",
      remoteUrl: "https://github.com/acme/widgets.git",
      repositoryId: "repo-id",
      refId: "ref-id",
    });
  });

  it("rejects incomplete list, get, create, update, and close responses at the gateway", () => {
    const incomplete = JSON.stringify({
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      state: "open",
      merged: false,
      base: { ref: "main" },
      head: { ref: "feature", sha: "candidate-sha" },
    });
    const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
    const readGateway = localGitHubPullRequestGateway({
      runGh: (args) => ({
        ok: true,
        stdout: args[1]?.includes("?") ? `[${incomplete}]` : incomplete,
      }),
    });
    expect(readGateway.findPullRequests(target, "feature")).toMatchObject({
      ok: false,
      evidence: { operation: "remote_lookup", classification: "response_parse_failure" },
    });
    expect(readGateway.getPullRequest(target, 42)).toMatchObject({
      ok: false,
      evidence: { operation: "remote_lookup", classification: "response_parse_failure" },
    });

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
    const mutationGateway = localGitHubPullRequestGateway({
      runGit: (args) => ({
        ok: true,
        stdout:
          args[0] === "rev-parse"
            ? "candidate-sha\n"
            : args[0] === "remote"
              ? "https://github.com/acme/widgets.git\n"
              : "",
      }),
      runGh: (args) =>
        args[1] === "graphql"
          ? { ok: true, stdout: remoteHeadResponse() }
          : { ok: true, stdout: incomplete },
    });
    expect(mutationGateway.createPullRequest(request)).toMatchObject({
      ok: false,
      code: "remote_response_unusable",
    });
    expect(
      mutationGateway.updatePullRequest({
        ...request,
        number: 42,
        expectedCurrentHeadSha: "previous-candidate-sha",
      }),
    ).toMatchObject({ ok: false, code: "remote_response_unusable" });
    expect(mutationGateway.closePullRequest({ target, number: 42 })).toMatchObject({
      ok: false,
      code: "close_failed",
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
            '{"number":42,"url":"https://api.github.com/repos/acme/widgets/pulls/42","state":"closed","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
        };
      },
    });

    expect(
      gateway.closePullRequest({
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
      gateway.closePullRequest({
        target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        number: 42,
      }),
    ).toMatchObject({
      ok: false,
      code: "close_failed",
      evidence: { operation: "pull_request_close", classification: "lost_response" },
    });
  });

  it("rejects an existing remote head before initial publication", () => {
    const gitCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? "candidate-sha\n"
              : args[0] === "remote"
                ? "https://github.com/acme/widgets.git\n"
                : "other-head\trefs/heads/feature\n",
        };
      },
      runGh: () => ({ ok: true, stdout: remoteHeadResponse("b".repeat(40)) }),
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
      ok: false,
      code: "remote_head_mismatch",
      observedRemoteHeadSha: "b".repeat(40),
    });
    expect(gitCalls.map((args) => args[0])).toEqual(["rev-parse", "remote"]);
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
      runGit: (args) => {
        if (args[0] === "rev-parse") return { ok: true, stdout: "candidate-sha\n" };
        if (args[0] === "remote")
          return { ok: true, stdout: "https://github.com/acme/widgets.git\n" };
        return { ok: false, status: 128, stderr: "remote unavailable" };
      },
      runGh: () => ({ ok: false, status: 1, stderr: "remote unavailable" }),
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

  it("treats malformed GitHub branch facts as unavailable without publication mutation", () => {
    const responses = [
      "not-json",
      "{}",
      '{"data":{"repository":null}}',
      '{"data":{"repository":{"ref":{"name":"other","prefix":"refs/heads/","target":{"oid":"candidate-sha"}}}}}',
      '{"data":{"repository":{"ref":{"name":"feature","target":{"oid":"candidate-sha"}}}}}',
      '{"data":{"repository":{"ref":{"name":"feature","prefix":"refs/heads/","target":{}}}}}',
      '{"data":{"repository":{"ref":{"name":"feature","prefix":"refs/heads/","target":{"oid":"invalid"}}}}}',
      JSON.stringify({
        data: {
          repository: {
            ref: {
              name: "feature",
              prefix: "refs/heads/",
              target: { oid: "f".repeat(2000) },
            },
          },
        },
      }),
      '{"data":{"repository":{"ref":null}},"errors":[{"message":"unavailable"}]}',
      '{"data":{"repository":{"ref":{"name":"feature","prefix":"refs/heads/","target":{"oid":"candidate-sha"}}}},"errors":"malformed"}',
      '{"data":{"repository":{"ref":{"name":"feature","prefix":"refs/heads/","target":{"oid":"candidate-sha"}}}},"errors":[]}',
    ];
    for (const stdout of responses) {
      const gitCalls: (readonly string[])[] = [];
      let ghCalls = 0;
      const gateway = localGitHubPullRequestGateway({
        runGit: (args) => {
          gitCalls.push(args);
          return {
            ok: true,
            stdout:
              args[0] === "rev-parse" ? "candidate-sha\n" : "https://github.com/acme/widgets.git\n",
          };
        },
        runGh: () => {
          ghCalls += 1;
          return { ok: true, stdout };
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
          title: "Publish",
          body: "Body",
        }),
      ).toMatchObject({
        ok: false,
        code: "remote_lookup_failed",
        evidence: { operation: "remote_lookup", classification: "response_parse_failure" },
      });
      expect(gitCalls.map((args) => args[0])).toEqual(["rev-parse", "remote"]);
      expect(ghCalls).toBe(1);
    }
  });

  it("accepts an exact existing remote branch during recovery without pushing again", () => {
    const gitCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return {
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? "candidate-sha\n"
              : args[0] === "remote"
                ? "https://github.com/acme/widgets.git\n"
                : "candidate-sha\trefs/heads/feature\n",
        };
      },
      runGh: (args) => ({
        ok: true,
        stdout:
          args[1] === "graphql"
            ? remoteHeadResponse("candidate-sha")
            : '{"number":42,"url":"https://github.com/acme/widgets/pull/42","state":"open","merged":false,"base":{"ref":"main","repo":{"owner":{"login":"acme"},"name":"widgets"}},"head":{"ref":"feature","sha":"candidate-sha"}}',
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
    expect(gitCalls.map((args) => args[0])).toEqual(["rev-parse", "remote"]);
  });

  it("preserves failed local head preflight evidence for create and update", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: () => ({ ok: false, status: 128, stderr: "worktree unavailable" }),
      runGh: () => ({ ok: true, stdout: "" }),
    });
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
    expect(gateway.createPullRequest(request)).toMatchObject({
      ok: false,
      code: "local_head_mismatch",
      evidence: { operation: "branch_push", exitStatus: 128 },
    });
    expect(
      gateway.updatePullRequest({ ...request, number: 42, expectedCurrentHeadSha: "old-head" }),
    ).toMatchObject({
      ok: false,
      code: "local_head_mismatch",
      evidence: { operation: "branch_push", exitStatus: 128 },
    });
  });

  it("reports failed pushes and bounds command evidence", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        if (args[0] === "rev-parse") return { ok: true, stdout: "candidate-sha\n" };
        if (args[0] === "remote")
          return { ok: true, stdout: "https://github.com/acme/widgets.git\n" };
        return {
          ok: false,
          status: 1,
          stdout: "https://github.com/acme/widgets.git",
          stderr: "Authorization: SUPERSECRET",
        };
      },
      runGh: () => ({ ok: true, stdout: remoteHeadResponse() }),
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
      evidence: { operation: "branch_push", exitStatus: 1 },
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
    expect(result.evidence).toEqual({
      operation: "branch_push",
      classification: "rejected",
      exitStatus: 1,
    });
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(JSON.stringify(result)).not.toContain("SUPERSECRET");
  });

  it("rejects unsafe push destinations without a push or pull request mutation", () => {
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
    const cases = [
      [
        "multiple",
        "https://github.com/acme/widgets.git\nhttps://github.com/acme/other.git\n",
        "destination_count",
      ],
      ["credentials", "https://user:SUPERSECRET@github.com/acme/widgets.git\n", "credentials"],
      [
        "query credential",
        "https://github.com/acme/widgets.git?access_token=SUPERSECRET\n",
        "malformed",
      ],
      ["fragment", "https://github.com/acme/widgets.git#SUPERSECRET\n", "malformed"],
      ["port", "ssh://git@github.com:443/acme/widgets.git\n", "malformed"],
      ["mismatch", "git@github.com:other/widgets.git\n", "repository_mismatch"],
      ["malformed", "not a URL\n", "malformed"],
    ] as const;
    for (const [name, destinations, reason] of cases) {
      const gitCalls: (readonly string[])[] = [];
      let ghCalls = 0;
      const gateway = localGitHubPullRequestGateway({
        runGit: (args) => {
          gitCalls.push(args);
          if (args[0] === "rev-parse") return { ok: true, stdout: "candidate-sha\n" };
          if (args[0] === "remote") return { ok: true, stdout: destinations };
          throw new Error(`must not push for ${name}`);
        },
        runGh: () => {
          ghCalls += 1;
          return { ok: true, stdout: "" };
        },
      });
      const result = gateway.createPullRequest(request);
      expect(result, name).toMatchObject({
        ok: false,
        code: "push_destination_failed",
        evidence: { operation: "push_destination", reason },
      });
      expect(gitCalls.map((args) => args[0])).toEqual(["rev-parse", "remote"]);
      expect(ghCalls).toBe(0);
      expect(JSON.stringify(result)).not.toContain("SUPERSECRET");
    }
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
        runGit: (args) => ({
          ok: true,
          stdout:
            args[0] === "rev-parse"
              ? "candidate-sha\n"
              : args[0] === "remote"
                ? "https://github.com/acme/widgets.git\n"
                : "",
        }),
        runGh: (args) =>
          args[1] === "graphql" ? { ok: true, stdout: remoteHeadResponse() } : response,
      });
      expect(gateway.createPullRequest(request)).toMatchObject({
        ok: false,
        evidence: { operation: "pull_request_creation", classification },
      });
    }
  });

  it("conditionally deletes an owned exact-head Remote Change Branch through GraphQL", () => {
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubChangeCleanupRemote({
      runGh: (args) => {
        ghCalls.push(args);
        return args.some((arg) => arg.includes("updateRefs"))
          ? {
              ok: true,
              stdout:
                '{"data":{"updateRefs":{"clientMutationId":null,"unknown":true},"unknown":true},"unknown":true}',
            }
          : {
              ok: true,
              stdout:
                '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","name":"refs/heads/but-why/feature","target":{"oid":"candidate-sha"}}}}}',
            };
      },
    });
    const branch = {
      repositoryCommonDirectory: "/repo/.git",
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/widgets.git",
      branchName: "but-why/feature",
      canonicalBranchRef: "refs/heads/but-why/feature",
      targetBranch: "main",
    };

    expect(gateway.readRemoteBranchHead(branch)).toEqual({
      state: "present",
      headSha: "candidate-sha",
      remoteUrl: branch.remoteUrl,
      repositoryId: "repo-id",
      refId: "ref-id",
    });
    expect(
      gateway.deleteRemoteBranch({
        ...branch,
        expectedHeadSha: "candidate-sha",
        resolvedRemoteUrl: branch.remoteUrl,
        repositoryId: "repo-id",
        refId: "ref-id",
      }),
    ).toEqual({ state: "deleted" });
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls[0]).toContain("qualifiedName=refs/heads/but-why/feature");
    const deletionArgs = ghCalls[1]?.join(" ") ?? "";
    expect(deletionArgs).toContain("name=refs/heads/but-why/feature");
    expect(deletionArgs).toContain("beforeOid=candidate-sha");
    const afterOid = `afterOid=${"0".repeat(40)}`;
    expect(deletionArgs).toContain(afterOid);
    const afterOidIndex = ghCalls[1]?.indexOf(afterOid) ?? -1;
    expect(ghCalls[1]?.[afterOidIndex - 1]).toBe("-f");
    expect(
      gateway.readRemoteBranchHead({
        ...branch,
        remoteUrl: "https://github.com/acme/other.git",
      }),
    ).toEqual({ state: "mismatch" });
    expect(ghCalls).toHaveLength(2);
  });

  it("reads the exact branch once after an uncertain GraphQL deletion response", () => {
    const input = {
      repositoryCommonDirectory: "/repo/.git",
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/widgets.git",
      branchName: "but-why/feature",
      canonicalBranchRef: "refs/heads/but-why/feature",
      targetBranch: "main",
      expectedHeadSha: "candidate-sha",
      resolvedRemoteUrl: "https://github.com/acme/widgets.git",
      repositoryId: "repo-id",
      refId: "ref-id",
    };
    const cases = [
      [
        "absent",
        {
          ok: true as const,
          stdout: '{"errors":[{"message":"response lost"}],"data":{"updateRefs":null}}',
        },
        {
          ok: true as const,
          stdout: '{"data":{"repository":{"defaultBranchRef":{"name":"main"},"ref":null}}}',
        },
        { state: "missing" as const },
      ],
      [
        "unchanged",
        { ok: true as const, stdout: "not-json" },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "candidate-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "null-envelope",
        { ok: true as const, stdout: "null" },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "candidate-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "array-envelope",
        { ok: true as const, stdout: "[]" },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "candidate-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "empty-errors",
        {
          ok: true as const,
          stdout: '{"data":{"updateRefs":{"clientMutationId":null}},"errors":[]}',
        },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "candidate-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "missing-selected-fact",
        { ok: true as const, stdout: '{"data":{"updateRefs":{}}}' },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "candidate-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "moved",
        { ok: false as const },
        {
          ok: true as const,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"moved-sha"}}}}}',
        },
        {
          state: "present" as const,
          headSha: "moved-sha",
          remoteUrl: input.remoteUrl,
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
      [
        "unreadable",
        { ok: false as const },
        { ok: false as const },
        { state: "unavailable" as const },
      ],
      [
        "read-error",
        { ok: false as const },
        { ok: true as const, stdout: '{"errors":[{"message":"read failed"}]}' },
        { state: "unavailable" as const },
      ],
      [
        "malformed-read",
        { ok: false as const },
        { ok: true as const, stdout: "not-json" },
        { state: "unavailable" as const },
      ],
    ] as const;

    for (const [name, deletionResponse, readResponse, expected] of cases) {
      const ghCalls: (readonly string[])[] = [];
      const gateway = localGitHubChangeCleanupRemote({
        runGh: (args) => {
          ghCalls.push(args);
          return ghCalls.length === 1 ? deletionResponse : readResponse;
        },
      });

      expect(gateway.deleteRemoteBranch(input), name).toEqual(expected);
      expect(ghCalls).toHaveLength(2);
      expect(ghCalls.filter((args) => args.some((arg) => arg.includes("updateRefs")))).toHaveLength(
        1,
      );
      expect(
        ghCalls.filter((args) =>
          args.some((arg) => arg.includes("qualifiedName=refs/heads/but-why/feature")),
        ),
      ).toHaveLength(1);
    }
  });

  it("protects the pull request target and default branch from remote deletion", () => {
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubChangeCleanupRemote({
      runGh: (args) => {
        ghCalls.push(args);
        return {
          ok: true,
          stdout:
            '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"but-why/default"},"ref":{"id":"ref-id","target":{"oid":"candidate-sha"}}}}}',
        };
      },
    });
    const input = {
      repositoryCommonDirectory: "/repo/.git",
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/widgets.git",
      branchName: "but-why/default",
      canonicalBranchRef: "refs/heads/but-why/default",
      targetBranch: "main",
    };
    expect(gateway.readRemoteBranchHead(input)).toEqual({ state: "excluded" });
    expect(ghCalls).toHaveLength(1);
    expect(
      gateway.readRemoteBranchHead({
        ...input,
        branchName: "but-why/main",
        canonicalBranchRef: "refs/heads/but-why/main",
        targetBranch: "but-why/main",
      }),
    ).toEqual({ state: "excluded" });
    expect(ghCalls).toHaveLength(1);
  });

  it("keeps missing, moved, and unavailable Remote Change Branches safe", () => {
    const input = {
      repositoryCommonDirectory: "/repo/.git",
      owner: "acme",
      repo: "widgets",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/widgets.git",
      branchName: "but-why/feature",
      canonicalBranchRef: "refs/heads/but-why/feature",
      targetBranch: "main",
    };
    for (const [stdout, expected] of [
      [
        '{"data":{"repository":{"defaultBranchRef":{"name":"main"},"ref":null}}}',
        { state: "missing" },
      ],
      [
        '{"data":{"repository":{"id":"repo-id","defaultBranchRef":{"name":"main"},"ref":{"id":"ref-id","target":{"oid":"moved-sha"}}}}}',
        {
          state: "present",
          headSha: "moved-sha",
          remoteUrl: "https://github.com/acme/widgets.git",
          repositoryId: "repo-id",
          refId: "ref-id",
        },
      ],
    ] as const) {
      const gateway = localGitHubChangeCleanupRemote({ runGh: () => ({ ok: true, stdout }) });
      expect(gateway.readRemoteBranchHead(input)).toMatchObject(expected);
    }
    const unavailable = localGitHubChangeCleanupRemote({ runGh: () => ({ ok: false }) });
    expect(unavailable.readRemoteBranchHead(input)).toEqual({ state: "unavailable" });
  });

  it("returns normalized safe evidence for a rejected creation", () => {
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => ({
        ok: true,
        stdout:
          args[0] === "rev-parse"
            ? "candidate-sha\n"
            : args[0] === "remote"
              ? "https://github.com/acme/widgets.git\n"
              : "",
      }),
      runGh: (args) =>
        args[1] === "--method"
          ? {
              ok: false,
              status: 422,
              stdout: "token=SECRET",
              stderr: "Authorization:\nBearer SECRET",
            }
          : { ok: true, stdout: remoteHeadResponse() },
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
