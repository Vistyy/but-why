import * as Migrator from "@effect/sql/Migrator";

import { baselineMigration as baseline } from "./migrations/0001_baseline.js";
import { taskSimplificationAdviceMigration } from "./migrations/0002_task_simplification_advice.js";

const migrations = {
  "0001_baseline": baseline,
  "0002_task_simplification_advice": taskSimplificationAdviceMigration,
} as const;

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
});

export const repositoryMigrationIds: readonly number[] = Object.keys(migrations)
  .map((key) => Number(key.slice(0, key.indexOf("_"))))
  .sort((left, right) => left - right);
