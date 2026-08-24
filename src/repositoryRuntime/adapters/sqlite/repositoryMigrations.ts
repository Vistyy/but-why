import * as Migrator from "@effect/sql/Migrator";

import { baselineMigration as baseline } from "./migrations/0001_baseline.js";
import { stallDetectionMigration } from "./migrations/0002_stall_detection.js";

const migrations = {
  "0001_baseline": baseline,
  "0002_stall_detection": stallDetectionMigration,
} as const;

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
});

export const repositoryMigrationIds: readonly number[] = Object.keys(migrations)
  .map((key) => Number(key.slice(0, key.indexOf("_"))))
  .sort((left, right) => left - right);
