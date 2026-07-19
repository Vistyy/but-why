import { describe, expect, it } from "vitest";

import { localGitHubPullRequestGateway } from "../src/publication/localGitHubPullRequestGateway.js";

describe("GitHub pull request gateway", () => {
  it("pushes the exact Candidate SHA before creating the pull request", () => {
    const gitCalls: (readonly string[])[] = [];
    const ghCalls: (readonly string[])[] = [];
    const gateway = localGitHubPullRequestGateway({
      runGit: (args) => {
        gitCalls.push(args);
        return { ok: true, stdout: "" };
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
    expect(gitCalls).toEqual([["push", "origin", "candidate-sha:refs/heads/feature"]]);
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
});
