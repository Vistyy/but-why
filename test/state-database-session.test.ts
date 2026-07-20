import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { findGitRoot } from "../src/init/git.js";
import {
  ensureStateDatabase,
  prepareStateDatabaseSession,
  SharedStateIdentityConflictError,
} from "../src/init/stateDatabase.js";
import { createGitRepo } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";

describe("state database session", () => {
  it("serves repeated operations through one prepared repository identity", () => {
    const root = createInitializedRepo();
    const session = sessionFor(root);

    expect(
      session.withDatabase((database) =>
        database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get(),
      ),
    ).toEqual({ count: 13 });
    expect(
      session.withDatabase((database) =>
        database.prepare("SELECT common_directory FROM shared_state_identity WHERE id = 1").get(),
      ),
    ).toEqual({ common_directory: gitRoot(root).commonDirectory });
  });

  it("reports an updated baseline when an existing state file is empty", () => {
    const root = createGitRepo();
    const statePath = join(gitRoot(root).commonDirectory, "but-why", "state.sqlite");
    mkdirSync(join(gitRoot(root).commonDirectory, "but-why"), { recursive: true });
    writeFileSync(statePath, "");

    expect(ensureStateDatabase(statePath, () => now, gitRoot(root).commonDirectory)).toBe(
      "updated",
    );
  });

  it("rejects a historical state database with reinitialization guidance", () => {
    const root = createGitRepo();
    const statePath = join(gitRoot(root).commonDirectory, "but-why", "state.sqlite");
    mkdirSync(join(gitRoot(root).commonDirectory, "but-why"), { recursive: true });
    const database = new DatabaseSync(statePath);
    database.exec("CREATE TABLE tasks (id TEXT); CREATE TABLE schema_migrations (name TEXT);");
    database.close();

    expect(() => ensureStateDatabase(statePath, () => now, gitRoot(root).commonDirectory)).toThrow(
      "State database uses an unsupported historical schema. Delete it and run by init.",
    );
  });

  it("rejects a database replaced with another repository identity", () => {
    const first = createInitializedRepo();
    const second = createInitializedRepo();
    const session = sessionFor(first);

    copyFileSync(statePath(second), statePath(first));

    expect(() => session.withDatabase(() => undefined)).toThrow(SharedStateIdentityConflictError);
  });

  it("prepares state that appears after repository context loading", () => {
    const root = createGitRepo();
    const resolved = gitRoot(root);
    const path = statePath(root);
    const session = prepareStateDatabaseSession({
      statePath: path,
      migrationTimestamp: () => now,
      commonDirectory: resolved.commonDirectory,
    });

    mkdirSync(join(resolved.commonDirectory, "but-why"), { recursive: true });
    ensureStateDatabase(path, () => now);

    expect(
      session.withDatabase((database) =>
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
  return prepareStateDatabaseSession({
    statePath: statePath(root),
    migrationTimestamp: () => now,
    commonDirectory: resolved.commonDirectory,
  });
};
