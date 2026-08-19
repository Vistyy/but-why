import { dirname, join, resolve } from "node:path";

export const disposableWorkspaceRoot = (repositoryCommonDirectory: string): string =>
  join(repositoryCommonDirectory, "but-why", "workspaces");

export const expectedDisposableWorkspacePath = (
  repositoryCommonDirectory: string,
  workspaceId: string,
): string => join(disposableWorkspaceRoot(repositoryCommonDirectory), workspaceId);

const isDisposableWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.length > 0 &&
  workspaceId !== "." &&
  workspaceId !== ".." &&
  !workspaceId.includes("/") &&
  !workspaceId.includes("\\");

export const isExpectedDisposableWorkspacePath = (
  repositoryCommonDirectory: string,
  workspaceId: string,
  worktreePath: string,
): boolean => {
  if (!isDisposableWorkspaceId(workspaceId)) return false;
  const root = resolve(disposableWorkspaceRoot(repositoryCommonDirectory));
  const expected = resolve(expectedDisposableWorkspacePath(repositoryCommonDirectory, workspaceId));
  return resolve(worktreePath) === expected && resolve(dirname(expected)) === root;
};
