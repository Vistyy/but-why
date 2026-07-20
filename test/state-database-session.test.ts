import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findGitRoot } from "../src/init/git.js";
import {
  initializeStateDatabase,
  prepareStateDatabase,
  SharedStateIdentityConflictError,
} from "../src/init/stateDatabase.js";
import { withStateDatabase } from "../src/sqlite/connection.js";
import { createGitRepo } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

describe("state database session", () => {
  it("serves repeated operations through one prepared repository identity", () => {
    const root = createInitializedRepo();
    const session = sessionFor(root);

    expect(
      withStateDatabase(session, (database) =>
        database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get(),
      ),
    ).toEqual({ count: 14 });
    expect(
      withStateDatabase(session, (database) =>
        database.prepare("SELECT common_directory FROM shared_state_identity WHERE id = 1").get(),
      ),
    ).toEqual({ common_directory: gitRoot(root).commonDirectory });
    expect(
      withStateDatabase(session, (database) =>
        database
          .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
          .all(),
      ),
    ).toEqual([{ migration_id: 1, name: "baseline" }]);
  });

  it("rejects a database replaced with another repository identity", () => {
    const first = createInitializedRepo();
    const second = createInitializedRepo();
    const session = sessionFor(first);

    copyFileSync(statePath(second), statePath(first));

    expect(() => withStateDatabase(session, () => undefined)).toThrow(
      SharedStateIdentityConflictError,
    );
  });

  it("closes the process-scoped database runtime when its owner finishes", async () => {
    const session = sessionFor(createInitializedRepo());

    await session.close();
  });

  it("prepares state that appears after repository context loading", () => {
    const root = createGitRepo();
    const resolved = gitRoot(root);
    const path = statePath(root);
    const session = prepareStateDatabase({
      statePath: path,
      commonDirectory: resolved.commonDirectory,
    });

    mkdirSync(join(resolved.commonDirectory, "but-why"), { recursive: true });
    initializeStateDatabase({ statePath: path });

    expect(
      withStateDatabase(session, (database) =>
        database.prepare("SELECT common_directory FROM shared_state_identity WHERE id = 1").get(),
      ),
    ).toEqual({ common_directory: resolved.commonDirectory });
  });
});

const gitRoot = (root: string) => {
  const result = findGitRoot(root);
  if (!result.ok) throw new Error(`Could not resolve Git root: ${root}`);
  return result;
};

const statePath = (root: string): string =>
  join(gitRoot(root).commonDirectory, "but-why", "state.sqlite");

const sessionFor = (root: string) => {
  const resolved = gitRoot(root);
  return prepareStateDatabase({
    statePath: statePath(root),
    commonDirectory: resolved.commonDirectory,
  });
};
