import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { inject, onTestFinished } from "vitest";

import type { StateDatabaseSession } from "../../src/init/stateDatabase.js";
import { createTempRoot } from "./by-cli.js";

export const createSqliteStateSession = (): StateDatabaseSession => {
  const statePath = join(createTempRoot(), "state.sqlite");

  copyFileSync(inject("stateDatabaseTemplatePath"), statePath);

  const database = new DatabaseSync(statePath);
  onTestFinished(() => database.close());

  return { withDatabase: (work) => work(database) };
};
