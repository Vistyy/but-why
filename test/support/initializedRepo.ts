import { createGitRepo, runBy } from "./by-cli.js";

export const createInitializedRepo = (): string => {
  const root = createGitRepo();
  const result = runBy(root, "init", "--task-prefix", "BY");

  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr);
  }

  return root;
};
