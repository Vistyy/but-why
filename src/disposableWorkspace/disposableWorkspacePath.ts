import { basename, dirname, join, resolve } from "node:path";

export const disposableWorkspaceRoot = (
  mainCheckoutRoot: string,
  workspaceContainerRoot?: string,
): string =>
  workspaceContainerRoot ??
  join(
    dirname(mainCheckoutRoot),
    `${basename(mainCheckoutRoot)}-worktrees`,
    "but-why",
    "validation-runs",
  );

export const expectedDisposableWorkspacePath = (
  mainCheckoutRoot: string,
  workspaceId: string,
  workspaceContainerRoot?: string,
): string => join(disposableWorkspaceRoot(mainCheckoutRoot, workspaceContainerRoot), workspaceId);

const isDisposableWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.length > 0 &&
  workspaceId !== "." &&
  workspaceId !== ".." &&
  !workspaceId.includes("/") &&
  !workspaceId.includes("\\");

export const isExpectedDisposableWorkspacePath = (
  mainCheckoutRoot: string,
  workspaceId: string,
  worktreePath: string,
  workspaceContainerRoot?: string,
): boolean => {
  if (!isDisposableWorkspaceId(workspaceId)) return false;
  const root = resolve(disposableWorkspaceRoot(mainCheckoutRoot, workspaceContainerRoot));
  const expected = resolve(
    expectedDisposableWorkspacePath(mainCheckoutRoot, workspaceId, workspaceContainerRoot),
  );
  return resolve(worktreePath) === expected && resolve(dirname(expected)) === root;
};
