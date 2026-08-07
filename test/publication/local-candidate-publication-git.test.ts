import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { localCandidatePublicationGit } from "../../src/change/publication/localCandidatePublicationGit.js";
import { createGitRepo } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

describe("local Candidate publication Git", () => {
  it("reads the first non-merge subject in starting-commit order", () => {
    const calls: (readonly string[])[] = [];
    const git = localCandidatePublicationGit({
      cwd: "/repo",
      runGit: (args) => {
        calls.push(args);
        return { ok: true, stdout: "First change\nSecond change\n" };
      },
    });

    expect(git.readFirstNonMergeCommitSubject("starting-sha", "candidate-sha")).toEqual({
      ok: true,
      subject: "First change",
    });
    expect(calls).toEqual([
      ["log", "--reverse", "--format=%s", "--no-merges", "starting-sha..candidate-sha"],
    ]);
  });

  it("reports commit history tooling failure instead of an empty history", () => {
    const git = localCandidatePublicationGit({
      cwd: "/repo",
      runGit: () => ({ ok: false }),
    });

    expect(git.readFirstNonMergeCommitSubject("starting-sha", "candidate-sha")).toEqual({
      ok: false,
    });
  });

  it("accepts and rejects publication facts from actual Git ancestry and branch heads", () => {
    const root = createGitRepo();
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test User");
    git(root, "checkout", "-b", "main");
    writeFileSync(join(root, "base.txt"), "base\n");
    git(root, "add", "base.txt");
    git(root, "commit", "-m", "base");
    const baseSha = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-b", "feature");
    writeFileSync(join(root, "feature.txt"), "feature\n");
    git(root, "add", "feature.txt");
    git(root, "commit", "-m", "feature work");
    const featureOne = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "feature.txt"), "feature two\n");
    git(root, "commit", "-am", "second feature");
    const featureHead = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "main");
    writeFileSync(join(root, "divergent.txt"), "divergent\n");
    git(root, "add", "divergent.txt");
    git(root, "commit", "-m", "divergent main work");
    const divergentSha = git(root, "rev-parse", "HEAD");

    const publicationGit = localCandidatePublicationGit({ cwd: root });

    expect(publicationGit.readBranchHead("refs/heads/feature")).toBe(featureHead);
    expect(publicationGit.readBranchHead("refs/heads/missing")).toBeUndefined();
    expect(publicationGit.containsCommit?.(featureHead, baseSha)).toBe(true);
    expect(publicationGit.containsCommit?.(featureHead, featureOne)).toBe(true);
    expect(publicationGit.containsCommit?.(featureHead, divergentSha)).toBe(false);
    expect(publicationGit.readFirstNonMergeCommitSubject(baseSha, featureHead)).toEqual({
      ok: true,
      subject: "feature work",
    });
    expect(
      publicationGit.readFirstNonMergeCommitSubject("refs/heads/missing", featureHead),
    ).toEqual({ ok: false });

    git(root, "checkout", "feature");
    git(root, "reset", "--hard", featureOne);
    expect(publicationGit.readBranchHead("refs/heads/feature")).toBe(featureOne);
  });
});

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = runTestProcess("git", args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
