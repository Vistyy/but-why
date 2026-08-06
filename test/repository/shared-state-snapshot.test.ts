import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { Effect } from "effect";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";

import { runByInProcessEffect, createGitRepo } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

const statePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");
const snapshotsPath = (root: string): string => join(root, ".git", "but-why", "snapshots");

const snapshotPathFromToon = (stdout: string): string => {
  const value = stdout.trim().replace(/^snapshotPath:\s+/u, "");
  return value.replace(/^"|"$/gu, "");
};

const runGit = (cwd: string, ...args: readonly string[]): void => {
  const result = runTestProcess("git", args, { cwd });
  expect(result.status, result.stderr || result.stdout).toBe(0);
};

describe("Shared Repository State Snapshots", () => {
  it.effect("creates unique readable immutable snapshots without changing source state", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);

      const seededSource = new DatabaseSync(statePath(root));
      seededSource.exec(
        "CREATE TABLE snapshot_facts (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO snapshot_facts VALUES (1, 'before'), (2, 'work')",
      );
      seededSource.close();
      const sourceBefore = readFileSync(statePath(root));
      const toon = yield* runByInProcessEffect(root, ["snapshot"]);
      const json = yield* runByInProcessEffect(root, ["--json", "snapshot"]);
      const firstPath = snapshotPathFromToon(toon.stdout);
      const second = JSON.parse(json.stdout) as { readonly snapshotPath?: string };

      expect(toon.status).toBe(0);
      expect(json.status).toBe(0);
      expect(toon.stdout.trim().split("\n")).toHaveLength(1);
      expect(Object.keys(second)).toEqual(["snapshotPath"]);
      expect(second.snapshotPath).toBeDefined();
      expect(firstPath).not.toBe(second.snapshotPath);
      expect(isAbsolute(firstPath)).toBe(true);
      expect(firstPath.startsWith(`${snapshotsPath(root)}/`)).toBe(true);
      expect(second.snapshotPath?.startsWith(`${snapshotsPath(root)}/`)).toBe(true);
      expect(readFileSync(statePath(root))).toEqual(sourceBefore);

      const source = new DatabaseSync(statePath(root), { readOnly: true });
      const sourceTableCount = source.prepare("SELECT count(*) AS count FROM sqlite_schema").get();
      source.close();
      const snapshot = new DatabaseSync(firstPath, { readOnly: true });
      const snapshotTableCount = snapshot
        .prepare("SELECT count(*) AS count FROM sqlite_schema")
        .get();
      const sourceConnection = new DatabaseSync(statePath(root), { readOnly: true });
      const sourceFacts = sourceConnection
        .prepare("SELECT id, value FROM snapshot_facts ORDER BY id")
        .all();
      sourceConnection.close();
      const snapshotFacts = snapshot
        .prepare("SELECT id, value FROM snapshot_facts ORDER BY id")
        .all();
      snapshot.close();
      expect(snapshotTableCount).toEqual(sourceTableCount);
      expect(snapshotFacts).toEqual(sourceFacts);

      const writableSource = new DatabaseSync(statePath(root));
      writableSource.exec("CREATE TABLE later(value TEXT)");
      writableSource.close();

      const unchangedSnapshot = new DatabaseSync(firstPath, { readOnly: true });
      const laterTable = unchangedSnapshot
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'later'")
        .all();
      unchangedSnapshot.close();
      expect(laterTable).toEqual([]);
    }),
  );

  it.effect("resolves one source and snapshot directory from main and linked worktrees", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      runGit(root, "config", "user.name", "But Why Test");
      runGit(root, "config", "user.email", "but-why@example.test");
      runGit(root, "add", ".but-why/config.json", ".gitignore");
      runGit(root, "commit", "-m", "Initialize But Why");

      const linked = `${root}-linked`;
      runGit(root, "worktree", "add", "-q", "-b", "linked", linked);
      const mainResult = yield* runByInProcessEffect(root, ["--json", "snapshot"]);
      const linkedResult = yield* runByInProcessEffect(linked, ["--json", "snapshot"]);
      const mainPath = (JSON.parse(mainResult.stdout) as { snapshotPath: string }).snapshotPath;
      const linkedPath = (JSON.parse(linkedResult.stdout) as { snapshotPath: string }).snapshotPath;

      expect(mainResult.status).toBe(0);
      expect(linkedResult.status).toBe(0);
      expect(mainPath).not.toBe(linkedPath);
      expect(mainPath.startsWith(`${snapshotsPath(root)}/`)).toBe(true);
      expect(linkedPath.startsWith(`${snapshotsPath(root)}/`)).toBe(true);
      expect(existsSync(mainPath)).toBe(true);
      expect(existsSync(linkedPath)).toBe(true);
    }),
  );

  it.effect("identifies snapshot storage in failure guidance", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      writeFileSync(snapshotsPath(root), "not a directory\n");

      const result = yield* runByInProcessEffect(root, ["--json", "snapshot"]);
      const output = JSON.parse(result.stdout) as {
        readonly error?: { readonly code?: string };
        readonly help?: readonly string[];
        readonly snapshotPath?: string;
      };

      expect(result.status).toBe(1);
      expect(output.error?.code).toBe("snapshot_creation_failed");
      expect(output.snapshotPath).toBeUndefined();
      expect(output.help?.[0]).toContain("snapshots directory is writable");
    }),
  );

  it.effect("returns no snapshot path and leaves no output after a source failure", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      expect(initialized.status).toBe(0);
      writeFileSync(statePath(root), "not sqlite\n");

      const result = yield* runByInProcessEffect(root, ["--json", "snapshot"]);
      const output = JSON.parse(result.stdout) as { readonly snapshotPath?: string };

      expect(result.status).toBe(1);
      expect(output.snapshotPath).toBeUndefined();
      expect(existsSync(snapshotsPath(root))).toBe(true);
      expect(readdirSync(snapshotsPath(root))).toEqual([]);
    }),
  );
});
