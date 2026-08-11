import { basename, dirname, join, resolve } from "node:path";

export const disposableWorkspaceRoot = (mainCheckoutRoot: string): string =>
  join(
    dirname(mainCheckoutRoot),
    `${basename(mainCheckoutRoot)}-worktrees`,
    "but-why",
    "validation-runs",
  );

export const expectedDisposableWorkspacePath = (
  mainCheckoutRoot: string,
  workspaceId: string,
): string => join(disposableWorkspaceRoot(mainCheckoutRoot), workspaceId);

export const isExpectedDisposableWorkspacePath = (
  mainCheckoutRoot: string,
  workspaceId: string,
  worktreePath: string,
): boolean => {
  if (
    workspaceId.length === 0 ||
    workspaceId === "." ||
    workspaceId === ".." ||
    workspaceId.includes("/") ||
    workspaceId.includes("\\")
  ) {
    return false;
  }
  const root = resolve(disposableWorkspaceRoot(mainCheckoutRoot));
  const expected = resolve(expectedDisposableWorkspacePath(mainCheckoutRoot, workspaceId));
  return resolve(worktreePath) === expected && resolve(dirname(expected)) === root;
};
