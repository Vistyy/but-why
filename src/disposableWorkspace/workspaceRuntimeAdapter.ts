import { createSandbox } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";
import { WorkspaceCommandExecutionFailed } from "../command/workspaceCommand.js";

export type WorkspaceRuntime = {
  readonly close: () => Promise<{ readonly preservedWorktreePath?: string }>;
  readonly worktreePath: string;
  readonly commandExecutor: WorkspaceCommandExecutor;
};

export const createWorkspaceRuntime = async (input: {
  readonly repoRoot: string;
  readonly tempRefName: string;
  readonly copyFiles: readonly string[];
}): Promise<WorkspaceRuntime> => {
  const sandbox = await createSandbox({
    cwd: input.repoRoot,
    branch: input.tempRefName,
    sandbox: noSandbox(),
    copyToWorktree: [...input.copyFiles],
  });

  return {
    worktreePath: sandbox.worktreePath,
    close: () => sandbox.close(),
    commandExecutor: async (command, options) => {
      try {
        return await sandbox.exec(command, options);
      } catch (error) {
        throw new WorkspaceCommandExecutionFailed({ message: errorMessage(error) });
      }
    },
  };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
