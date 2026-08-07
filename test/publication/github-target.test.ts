import { describe, expect, it } from "vitest";
import type { GitCommandRunner } from "../../src/submissionEnvironment/gitFacts.js";
import {
  detectGitHubPrTarget,
  type GhCommandRunner,
} from "../../src/submissionEnvironment/githubTarget.js";

const cwd = "/repo";

const gitFor =
  (url: string): GitCommandRunner =>
  (args) => {
    const command = args.join(" ");
    if (command === "remote") return { ok: true, stdout: "origin\n" };
    if (command === "remote get-url origin" || command === "config --get remote.origin.url") {
      return { ok: true, stdout: `${url}\n` };
    }
    return { ok: false, code: "command_failed" };
  };

const ghWithDefault =
  (baseBranch = "main"): GhCommandRunner =>
  (args) =>
    args[0] === "pr"
      ? { ok: false, code: "command_failed" }
      : { ok: true, stdout: JSON.stringify({ defaultBranchRef: { name: baseBranch } }) };

describe("GitHub PR target detection", () => {
  it.each([
    "https://github.com/acme/widgets",
    "https://github.com/acme/widgets.git",
    "git@github.com:acme/widgets",
    "git@github.com:acme/widgets.git",
    "ssh://git@github.com/acme/widgets",
    "ssh://git@github.com/acme/widgets.git",
  ])("accepts the supported remote form %s", (url) => {
    expect(detectGitHubPrTarget(cwd, "feature", gitFor(url), ghWithDefault())).toEqual({
      ok: true,
      target: {
        owner: "acme",
        repo: "widgets",
        baseBranch: "main",
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
  ])("rejects the unsupported or malformed remote %s", (url) => {
    expect(detectGitHubPrTarget(cwd, "feature", gitFor(url), ghWithDefault())).toEqual({
      ok: false,
      code: "PR_TARGET_NOT_FOUND",
    });
  });

  it("prefers the canonical main checkout upstream publication remote", () => {
    const runGit: GitCommandRunner = (args) => {
      const command = args.join(" ");
      if (command === "remote") return { ok: true, stdout: "origin\nupstream\n" };
      if (command === "remote get-url origin") {
        return { ok: true, stdout: "https://github.com/acme/fork.git\n" };
      }
      if (command === "remote get-url upstream") {
        return { ok: true, stdout: "https://github.com/acme/widgets.git\n" };
      }
      if (command === "worktree list --porcelain") {
        return { ok: true, stdout: "worktree /repo\nHEAD abc\nbranch refs/heads/main\n" };
      }
      if (command === "config --get branch.main.remote") {
        return { ok: true, stdout: "upstream\n" };
      }
      return { ok: false };
    };

    expect(detectGitHubPrTarget(cwd, "feature", runGit, ghWithDefault())).toMatchObject({
      ok: true,
      target: { remoteName: "upstream", repo: "widgets" },
    });
  });

  it("uses the selected remote Change Base as the pull request target", () => {
    const runGit = gitFor("git@github.com:acme/widgets.git");
    expect(
      detectGitHubPrTarget(
        cwd,
        "feature",
        runGit,
        ghWithDefault("ignored"),
        "refs/remotes/origin/release/next",
      ),
    ).toMatchObject({
      ok: true,
      target: { remoteName: "origin", baseBranch: "release/next" },
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
  ])("rejects the malformed Change Base ref %s before invoking GitHub", (baseRef) => {
    let ghCalls = 0;
    const gh: GhCommandRunner = () => {
      ghCalls += 1;
      return { ok: true, stdout: '{"defaultBranchRef":{"name":"main"}}' };
    };

    expect(
      detectGitHubPrTarget(
        cwd,
        "feature",
        gitFor("https://github.com/acme/widgets"),
        gh,
        baseRef,
        "https://github.com/acme/widgets",
      ),
    ).toEqual({ ok: false, code: "PR_TARGET_NOT_FOUND" });
    expect(ghCalls).toBe(0);
  });

  it("uses the existing pull request base branch", () => {
    const gh: GhCommandRunner = (args) =>
      args[0] === "pr"
        ? { ok: true, stdout: '{"baseRefName":"release"}' }
        : { ok: false, code: "tooling_error" };
    expect(
      detectGitHubPrTarget(cwd, "feature", gitFor("git@github.com:acme/widgets.git"), gh),
    ).toMatchObject({
      ok: true,
      target: { baseBranch: "release" },
    });
  });

  it("reports a missing or malformed default branch", () => {
    const gh: GhCommandRunner = (args) =>
      args[0] === "pr"
        ? { ok: false, code: "command_failed" }
        : { ok: true, stdout: '{"defaultBranchRef":null}' };
    expect(
      detectGitHubPrTarget(cwd, "feature", gitFor("https://github.com/acme/widgets"), gh),
    ).toEqual({
      ok: false,
      code: "PR_TARGET_NOT_FOUND",
    });
  });

  it("reports Git and GitHub tooling failures", () => {
    const gitFailure: GitCommandRunner = () => ({ ok: false, code: "tooling_error" });
    expect(detectGitHubPrTarget(cwd, "feature", gitFailure, ghWithDefault())).toEqual({
      ok: false,
      code: "GITHUB_TOOLING_ERROR",
    });

    const ghFailure: GhCommandRunner = () => ({ ok: false, code: "tooling_error" });
    expect(
      detectGitHubPrTarget(cwd, "feature", gitFor("https://github.com/acme/widgets"), ghFailure),
    ).toEqual({
      ok: false,
      code: "GITHUB_TOOLING_ERROR",
    });
  });
});
