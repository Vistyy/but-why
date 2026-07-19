import { describe, expect, it } from "vitest";

import { localGitHubPullRequestGateway } from "../src/publication/localGitHubPullRequestGateway.js";

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
      ["push", "origin", "candidate-sha:refs/heads/feature"],
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
