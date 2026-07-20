import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeStateDatabase } from "../src/init/stateDatabase.js";

export default function setup(project: {
  readonly provide: (key: string, value: unknown) => void;
}): () => void {
  const root = mkdtempSync(join(tmpdir(), "but-why-test-global-"));
  const statePath = join(root, "state.sqlite");

  initializeStateDatabase({ statePath });
  project.provide("stateDatabaseTemplatePath", statePath);

  return () => rmSync(root, { recursive: true, force: true });
}
