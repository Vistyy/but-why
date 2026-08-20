import { spawnSync } from "node:child_process";

import { associateRepositoryBranchUpstream } from "../../adapters/localRepositoryBranchUpstream.js";
import type { CandidatePublicationGit, CommitSubjectResult } from "../candidatePublication.js";

export type PublicationGitCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly status?: number | null };

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
    containsCommit: (headSha, ancestorSha) =>
      containsCommit(runGit, input.cwd, headSha, ancestorSha),
    readFirstNonMergeCommitSubject: (startingCommit, headSha) =>
      readFirstNonMergeCommitSubject(runGit, input.cwd, startingCommit, headSha),
    associateRepositoryBranchUpstream: (branchRef, remoteName, remoteBranchName) =>
      associateRepositoryBranchUpstream(runGit, input.cwd, {
        branchRef,
        remoteName,
        remoteBranchName,
      })
        ? { ok: true }
        : { ok: false },
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

const containsCommit = (
  runGit: PublicationGitCommandRunner,
  cwd: string,
  headSha: string,
  ancestorSha: string,
): boolean => runGit(["merge-base", "--is-ancestor", ancestorSha, headSha], cwd).ok;

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
