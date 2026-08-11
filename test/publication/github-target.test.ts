import { describe, expect, it } from "vitest";
import type { GitCommandRunner } from "../../src/submissionEnvironment/adapters/gitFacts.js";
import { detectGitHubPrTarget } from "../../src/submissionEnvironment/adapters/githubTarget.js";

const cwd = "/repo";

const gitFor =
  (url: string): GitCommandRunner =>
  (args) =>
    args.join(" ") === "config --get remote.origin.url"
      ? { ok: true, stdout: `${url}\n` }
      : { ok: false, code: "command_failed" };

describe("GitHub PR target detection", () => {
  it.each([
    "https://github.com/acme/widgets",
    "https://github.com/acme/widgets.git",
    "git@github.com:acme/widgets",
    "git@github.com:acme/widgets.git",
    "ssh://git@github.com/acme/widgets",
    "ssh://git@github.com/acme/widgets.git",
  ])("uses the recorded Change Base remote with supported URL %s", (url) => {
    expect(detectGitHubPrTarget(cwd, "refs/remotes/origin/release/next", gitFor(url))).toEqual({
      ok: true,
      target: {
        owner: "acme",
        repo: "widgets",
        baseBranch: "release/next",
        remoteName: "origin",
        remoteUrl: url,
      },
    });
  });

  it.each([
    "http://github.com/acme/widgets",
    "https://gitlab.com/acme/widgets",
    "https://github.com/acme",
    "git@github.com:acme",
    "ssh://github.com/acme/widgets",
  ])("rejects unsupported or malformed remote URL %s", (url) => {
    expect(detectGitHubPrTarget(cwd, "refs/remotes/origin/main", gitFor(url))).toEqual({
      ok: false,
      code: "PR_TARGET_NOT_FOUND",
    });
  });

  it.each([
    "main",
    "refs/heads/main",
    "refs/remotes/origin",
    "refs/remotes/origin/",
    "refs/remotes//main",
    "origin/main",
    "",
  ])("rejects malformed Change Base ref %s before reading Git", (baseRef) => {
    let gitCalls = 0;
    const runGit: GitCommandRunner = () => {
      gitCalls += 1;
      return { ok: true, stdout: "https://github.com/acme/widgets" };
    };
    expect(detectGitHubPrTarget(cwd, baseRef, runGit)).toEqual({
      ok: false,
      code: "PR_TARGET_NOT_FOUND",
    });
    expect(gitCalls).toBe(0);
  });

  it("uses the recorded selected remote URL when supplied", () => {
    expect(
      detectGitHubPrTarget(
        cwd,
        "refs/remotes/upstream/main",
        () => {
          throw new Error("must not read mutable remote configuration");
        },
        "git@github.com:acme/widgets.git",
      ),
    ).toMatchObject({ ok: true, target: { remoteName: "upstream", repo: "widgets" } });
  });

  it("reports Git tooling failure", () => {
    expect(detectGitHubPrTarget(cwd, "refs/remotes/origin/main", () => ({ ok: false }))).toEqual({
      ok: false,
      code: "GITHUB_TOOLING_ERROR",
    });
  });
});
