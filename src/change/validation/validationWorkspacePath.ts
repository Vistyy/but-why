import { join } from "node:path";

export const validationTempRefName = (validationRunId: string): string =>
  `refs/but-why/validation-runs/${validationRunId}/validation`;

export const expectedSandcastleWorktreePath = (repoRoot: string, tempRefName: string): string =>
  join(repoRoot, ".sandcastle", "worktrees", tempRefName.replaceAll("/", "-"));
