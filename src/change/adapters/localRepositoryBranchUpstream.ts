import { branchNameForRef } from "../changeBranch.js";

export type RepositoryBranchUpstreamInput = {
  readonly branchRef: string;
  readonly remoteName: string;
  readonly remoteBranchName: string;
};

export type RepositoryBranchUpstreamCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status?: number | null };

export type RepositoryBranchUpstreamCommandRunner = (
  args: readonly string[],
  cwd: string,
) => RepositoryBranchUpstreamCommandResult;

export const associateRepositoryBranchUpstream = (
  runGit: RepositoryBranchUpstreamCommandRunner,
  cwd: string,
  input: RepositoryBranchUpstreamInput,
): boolean => {
  const branchName = branchNameForRef(input.branchRef);
  if (
    branchName === undefined ||
    input.remoteName.length === 0 ||
    input.remoteBranchName.length === 0
  )
    return false;

  const remote = runGit(
    ["config", "--local", "--replace-all", `branch.${branchName}.remote`, input.remoteName],
    cwd,
  );
  if (!remote.ok) return false;

  return runGit(
    [
      "config",
      "--local",
      "--replace-all",
      `branch.${branchName}.merge`,
      `refs/heads/${input.remoteBranchName}`,
    ],
    cwd,
  ).ok;
};

export const removeRepositoryBranchUpstream = (
  runGit: RepositoryBranchUpstreamCommandRunner,
  cwd: string,
  input: RepositoryBranchUpstreamInput,
): boolean => {
  const branchName = branchNameForRef(input.branchRef);
  if (
    branchName === undefined ||
    input.remoteName.length === 0 ||
    input.remoteBranchName.length === 0
  )
    return false;

  return ["remote", "merge"].every((key) => {
    const result = runGit(["config", "--local", "--unset-all", `branch.${branchName}.${key}`], cwd);
    return result.ok || result.status === 5;
  });
};
