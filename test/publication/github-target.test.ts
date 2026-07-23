import { describe, expect, it } from "vitest";

import {
  detectGitHubPrTarget,
  type GhCommandRunner,
} from "../../src/submissionEnvironment/githubTarget.js";
import type { GitCommandRunner } from "../../src/submissionEnvironment/gitFacts.js";

const cwd = "/repo";

const gitFor =
  (url: string): GitCommandRunner =>
  (args) => {
    const command = args.join(" ");
    if (command === "remote") return { ok: true, stdout: "origin\n" };
    if (command === "remote get-url origin") return { ok: true, stdout: `${url}\n` };
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
