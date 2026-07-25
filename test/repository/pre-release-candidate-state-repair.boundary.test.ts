import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import { createTestWorkspace } from "../support/testWorkspace.js";

const repositoryRoot = process.cwd();

describe("pre-release Candidate state repair", () => {
  it("conditionally preserves every record and verifies repaired database integrity", () => {
    const workspace = createTestWorkspace();
    const databasePath = join(workspace, "state.sqlite");
    const backupPath = join(workspace, "state.before-candidate-repair.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id),
        publication_candidate_id TEXT
      );
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL REFERENCES changes(id),
        selected_base_ref TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (change_id, resolved_target_sha, comparison_base_sha, head_sha)
      );
      CREATE TABLE candidate_validation_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id)
      );
      CREATE TABLE candidate_validation_findings (
        id TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL REFERENCES candidate_validation_runs(id)
      );
      CREATE TABLE candidate_validation_artifacts (
        ref TEXT PRIMARY KEY,
        validation_run_id TEXT NOT NULL REFERENCES candidate_validation_runs(id)
      );
      INSERT INTO tasks VALUES ('task-1');
      INSERT INTO changes VALUES ('change-1', 'task-1', NULL);
      INSERT INTO candidates VALUES (
        'candidate-1', 'change-1', 'refs/remotes/origin/main',
        'fresh-base', 'old-merge-base', 'head', '2026-07-25T00:00:00.000Z'
      );
      INSERT INTO candidate_validation_runs VALUES ('run-1', 'candidate-1');
      INSERT INTO candidate_validation_findings VALUES ('finding-1', 'run-1');
      INSERT INTO candidate_validation_artifacts VALUES ('artifact-1', 'run-1');
      UPDATE changes SET publication_candidate_id = 'candidate-1' WHERE id = 'change-1';
    `);
    database.close();

    const repaired = spawnSync(
      "just",
      ["repair-pre-release-candidate-state", databasePath, backupPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(repaired.status).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({
      status: "repaired",
      databasePath,
      backupPath,
      preservedRowCounts: {
        tasks: 1,
        changes: 1,
        candidates: 1,
        candidate_validation_runs: 1,
        candidate_validation_findings: 1,
        candidate_validation_artifacts: 1,
      },
    });
    expect(existsSync(backupPath)).toBe(true);

    const repairedDatabase = new DatabaseSync(databasePath);
    expect(repairedDatabase.prepare("PRAGMA table_info(candidates)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "change_base_sha" }),
        expect.objectContaining({ name: "head_sha" }),
      ]),
    );
    expect(
      repairedDatabase
        .prepare("SELECT id, change_id, change_base_sha, head_sha FROM candidates")
        .get(),
    ).toEqual({
      id: "candidate-1",
      change_id: "change-1",
      change_base_sha: "fresh-base",
      head_sha: "head",
    });
    expect(repairedDatabase.prepare("SELECT publication_candidate_id FROM changes").get()).toEqual({
      publication_candidate_id: "candidate-1",
    });
    expect(repairedDatabase.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(repairedDatabase.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    repairedDatabase.close();

    const alreadyRepaired = spawnSync(
      "just",
      ["repair-pre-release-candidate-state", databasePath, join(workspace, "unused.sqlite")],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(alreadyRepaired.status).toBe(0);
    expect(JSON.parse(alreadyRepaired.stdout)).toEqual({
      status: "already_repaired",
      databasePath,
    });
  });

  it("rejects Candidate identity collisions before backup or mutation", () => {
    const workspace = createTestWorkspace();
    const databasePath = join(workspace, "collision.sqlite");
    const backupPath = join(workspace, "collision.backup.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE changes (id TEXT PRIMARY KEY);
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL REFERENCES changes(id),
        selected_base_ref TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (change_id, resolved_target_sha, comparison_base_sha, head_sha)
      );
      INSERT INTO changes VALUES ('change-1');
      INSERT INTO candidates VALUES
        ('candidate-1', 'change-1', 'refs/remotes/origin/main', 'base', 'merge-base-1', 'head', '2026-07-25T00:00:00.000Z'),
        ('candidate-2', 'change-1', 'refs/remotes/origin/main', 'base', 'merge-base-2', 'head', '2026-07-25T00:01:00.000Z');
    `);
    database.close();

    const rejected = spawnSync(
      "just",
      ["repair-pre-release-candidate-state", databasePath, backupPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("repair would merge distinct Candidate records");
    expect(existsSync(backupPath)).toBe(false);
    const preserved = new DatabaseSync(databasePath);
    expect(preserved.prepare("SELECT COUNT(*) AS count FROM candidates").get()).toEqual({
      count: 2,
    });
    expect(preserved.prepare("PRAGMA table_info(candidates)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "resolved_target_sha" })]),
    );
    preserved.close();
  });

  it("rolls back when repaired references fail verification", () => {
    const workspace = createTestWorkspace();
    const databasePath = join(workspace, "invalid-reference.sqlite");
    const backupPath = join(workspace, "invalid-reference.backup.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE changes (id TEXT PRIMARY KEY);
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL REFERENCES changes(id),
        selected_base_ref TEXT NOT NULL,
        resolved_target_sha TEXT NOT NULL,
        comparison_base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE candidate_validation_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id)
      );
      INSERT INTO changes VALUES ('change-1');
      INSERT INTO candidates VALUES (
        'candidate-1', 'change-1', 'refs/remotes/origin/main',
        'base', 'merge-base', 'head', '2026-07-25T00:00:00.000Z'
      );
      INSERT INTO candidate_validation_runs VALUES ('run-1', 'missing-candidate');
    `);
    database.close();

    const rejected = spawnSync(
      "just",
      ["repair-pre-release-candidate-state", databasePath, backupPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("repair rolled back");
    expect(existsSync(backupPath)).toBe(true);
    const preserved = new DatabaseSync(databasePath);
    expect(preserved.prepare("PRAGMA table_info(candidates)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "resolved_target_sha" })]),
    );
    expect(preserved.prepare("SELECT id FROM candidates").all()).toEqual([{ id: "candidate-1" }]);
    preserved.close();
  });

  it("rejects an existing backup before opening the source schema", () => {
    const workspace = createTestWorkspace();
    const databasePath = join(workspace, "source.sqlite");
    const backupPath = join(workspace, "existing-backup.sqlite");
    writeFileSync(databasePath, "not a database");
    writeFileSync(backupPath, "preserve me");

    const rejected = spawnSync(
      "just",
      ["repair-pre-release-candidate-state", databasePath, backupPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("backup path already exists");
  });
});
