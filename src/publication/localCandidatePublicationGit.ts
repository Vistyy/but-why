import { spawnSync } from "node:child_process";

import type { CandidatePublicationGit, CommitSubjectResult } from "./publishCandidate.js";

export type PublicationGitCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false };

export type PublicationGitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => PublicationGitCommandResult;

export const localCandidatePublicationGit = (input: {
  readonly cwd: string;
  readonly runGit?: PublicationGitCommandRunner;
}): CandidatePublicationGit => {
  const runGit = input.runGit ?? runGitCommand;
  return {
    readBranchHead: (branchRef) => readBranchHead(runGit, input.cwd, branchRef),
    readFirstNonMergeCommitSubject: (startingCommit, headSha) =>
      readFirstNonMergeCommitSubject(runGit, input.cwd, startingCommit, headSha),
  };
};

const readBranchHead = (
  runGit: PublicationGitCommandRunner,
  cwd: string,
  branchRef: string,
): string | undefined => {
  const result = runGit(["rev-parse", "--verify", `${branchRef}^{commit}`], cwd);
  const head = result.ok ? result.stdout.trim() : "";
  return head.length > 0 ? head : undefined;
};

const readFirstNonMergeCommitSubject = (
  runGit: PublicationGitCommandRunner,
  cwd: string,
  startingCommit: string,
  headSha: string,
): CommitSubjectResult => {
  const result = runGit(
    ["log", "--reverse", "--format=%s", "--no-merges", `${startingCommit}..${headSha}`],
    cwd,
  );
  if (!result.ok) return { ok: false };
  const subject = result.stdout
    .split("\n")
    .find((line) => line.length > 0)
    ?.trim();
  return {
    ok: true,
    subject: subject === undefined || subject.length === 0 ? undefined : subject,
  };
};

const runGitCommand: PublicationGitCommandRunner = (args, cwd) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};
