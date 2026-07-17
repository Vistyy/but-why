import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { inject, onTestFinished } from "vitest";

import type { StateDatabaseSession } from "../../src/init/stateDatabase.js";
import { openSqliteTaskStore } from "../../src/sqlite/sqliteTaskStore.js";
import type { TaskStore } from "../../src/task/taskStore.js";
import { createTempRoot } from "./by-cli.js";

export const createTaskStore = (taskPrefix = "BY"): TaskStore => {
  const statePath = join(createTempRoot(), "state.sqlite");

  copyFileSync(inject("stateDatabaseTemplatePath"), statePath);

  return openSqliteTaskStore({ ...testStateDatabaseSession(statePath), taskPrefix });
};

const testStateDatabaseSession = (statePath: string): StateDatabaseSession => {
  const database = new DatabaseSync(statePath);

  onTestFinished(() => database.close());

  return { withDatabase: (work) => work(database) };
};
