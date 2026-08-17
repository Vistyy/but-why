import * as Migrator from "@effect/sql/Migrator";

import { baselineMigration as baseline } from "./migrations/0001_baseline.js";

const migrations = { "0001_baseline": baseline } as const;

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
});

export const repositoryMigrationIds: readonly number[] = Object.keys(migrations)
  .map((key) => Number(key.slice(0, key.indexOf("_"))))
  .sort((left, right) => left - right);
