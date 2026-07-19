import { describe, expect, it } from "vitest";

import { localCandidatePublicationGit } from "../src/publication/localCandidatePublicationGit.js";

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

    expect(git.readFirstNonMergeCommitSubject("starting-sha", "candidate-sha")).toBe(
      "First change",
    );
    expect(calls).toEqual([
      ["log", "--reverse", "--format=%s", "--no-merges", "starting-sha..candidate-sha"],
    ]);
  });
});
