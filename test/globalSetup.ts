import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureStateDatabase } from "../src/init/stateDatabase.js";

export default function setup(project: {
  readonly provide: (key: string, value: unknown) => void;
}): () => void {
  const root = mkdtempSync(join(tmpdir(), "but-why-test-global-"));
  const statePath = join(root, "state.sqlite");

  ensureStateDatabase(statePath);
  project.provide("stateDatabaseTemplatePath", statePath);

  return () => rmSync(root, { recursive: true, force: true });
}
