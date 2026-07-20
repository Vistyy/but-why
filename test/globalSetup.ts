import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAllStateDatabases, initializeStateDatabase } from "../src/init/stateDatabase.js";

export default function setup(project: {
  readonly provide: (key: string, value: unknown) => void;
}): () => Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "but-why-test-global-"));
  const statePath = join(root, "state.sqlite");

  initializeStateDatabase({ statePath });
  project.provide("stateDatabaseTemplatePath", statePath);

  return async () => {
    await closeAllStateDatabases();
    rmSync(root, { recursive: true, force: true });
  };
}
