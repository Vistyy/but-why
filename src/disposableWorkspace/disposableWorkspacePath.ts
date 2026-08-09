import { join } from "node:path";

export const expectedDisposableWorkspacePath = (repoRoot: string, workspaceRef: string): string =>
  join(repoRoot, ".sandcastle", "worktrees", workspaceRef.replaceAll("/", "-"));
