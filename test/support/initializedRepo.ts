import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { inject } from "vitest";

import { findGitRoot } from "../../src/init/git.js";
import { ensureGitignoreBlock } from "../../src/init/gitignore.js";
import { writeRepoConfig } from "../../src/init/repoConfig.js";
import { bindStateDatabaseIdentity } from "../../src/init/stateDatabase.js";
import { createGitRepo } from "./by-cli.js";

export const createInitializedRepo = (): string => {
  const root = createGitRepo();
  const gitRoot = findGitRoot(root);

  if (!gitRoot.ok) {
    throw new Error(`Could not resolve Git root for test repository: ${root}`);
  }

  const butWhyDirectory = join(root, ".but-why");
  const operationalDirectory = join(gitRoot.commonDirectory, "but-why");
  const statePath = join(operationalDirectory, "state.sqlite");

  mkdirSync(join(butWhyDirectory, "reviewers"), { recursive: true });
  mkdirSync(operationalDirectory, { recursive: true });
  writeRepoConfig(join(butWhyDirectory, "config.json"), "BY");
  ensureGitignoreBlock(join(root, ".gitignore"));
  copyFileSync(inject("stateDatabaseTemplatePath"), statePath);
  bindStateDatabaseIdentity(statePath, gitRoot.commonDirectory);

  return root;
};

declare module "vitest" {
  export interface ProvidedContext {
    readonly stateDatabaseTemplatePath: string;
  }
}
