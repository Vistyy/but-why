import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { inject } from "vitest";

import { prepareStateDatabase, type StateDatabase } from "../../src/init/stateDatabase.js";
import { createTestWorkspace } from "./testWorkspace.js";

export const createSqliteState = (): StateDatabase => {
  const statePath = join(createTestWorkspace(), "state.sqlite");
  copyFileSync(inject("stateDatabaseTemplatePath"), statePath);
  return prepareStateDatabase({ statePath });
};
