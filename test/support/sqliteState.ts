import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { inject, onTestFinished } from "vitest";

import type { StateDatabaseSession } from "../../src/init/stateDatabase.js";
import { createTestWorkspace } from "./testWorkspace.js";

export const createSqliteStateSession = (): StateDatabaseSession => {
  const statePath = join(createTestWorkspace(), "state.sqlite");

  copyFileSync(inject("stateDatabaseTemplatePath"), statePath);

  const database = new DatabaseSync(statePath);
  onTestFinished(() => database.close());

  return { withDatabase: (work) => work(database) };
};
