import { join } from "node:path";

export const disposableWorkspaceIgnorePaths = [
  ".sandcastle/worktrees/",
  ".sandcastle/logs/",
  ".sandcastle/patches/",
  ".sandcastle/.env",
] as const;

export const expectedDisposableWorkspacePath = (repoRoot: string, workspaceRef: string): string =>
  join(repoRoot, ".sandcastle", "worktrees", workspaceRef.replaceAll("/", "-"));
