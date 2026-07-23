import { describe, expect, it } from "vitest";

import { localCandidatePublicationGit } from "../../src/change/publication/localCandidatePublicationGit.js";

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
});
