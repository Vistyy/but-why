import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

import {
  type SharedRepositoryStateSnapshot,
  SnapshotCreationFailed,
} from "../repositorySnapshot/snapshot.js";

export type SqliteSnapshotInput = {
  readonly sourcePath: string;
  readonly snapshotsPath: string;
};

const snapshotFileName = (): string => `${randomUUID()}.sqlite`;

const reserveSnapshotPath = (snapshotsPath: string): string => {
  mkdirSync(snapshotsPath, { recursive: true });

  for (;;) {
    const snapshotPath = join(snapshotsPath, snapshotFileName());
    try {
      const descriptor = openSync(snapshotPath, "wx");
      closeSync(descriptor);
      return snapshotPath;
    } catch (cause) {
      if (isExistingPathError(cause)) continue;
      throw cause;
    }
  }
};

const isExistingPathError = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST";

const removeIncompleteSnapshot = (snapshotPath: string): void => {
  try {
    if (existsSync(snapshotPath)) rmSync(snapshotPath, { force: true });
  } catch {
    // Best-effort cleanup is intentionally not a recovery mechanism.
  }
};

const createSnapshot = async (
  input: SqliteSnapshotInput,
): Promise<SharedRepositoryStateSnapshot> => {
  const source = new DatabaseSync(input.sourcePath, { readOnly: true, timeout: 5_000 });
  let snapshotPath: string | undefined;

  try {
    snapshotPath = reserveSnapshotPath(input.snapshotsPath);
    await backup(source, snapshotPath);

    const destination = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      destination.prepare("PRAGMA schema_version").get();
    } finally {
      destination.close();
    }

    return { snapshotPath };
  } catch (cause) {
    if (snapshotPath !== undefined) removeIncompleteSnapshot(snapshotPath);
    throw cause;
  } finally {
    source.close();
  }
};

export const createSqliteSnapshot = (
  input: SqliteSnapshotInput,
): Effect.Effect<SharedRepositoryStateSnapshot, SnapshotCreationFailed> =>
  Effect.tryPromise({
    try: () => createSnapshot(input),
    catch: (cause) => new SnapshotCreationFailed({ cause }),
  });
