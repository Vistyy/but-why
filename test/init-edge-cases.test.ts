import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { isTaskPrefix } from "../src/contracts/taskPrefix.js";
import {
  cleanupTempRoots,
  createGitRepo,
  runByInProcessArgs as runBy,
  runByWithEnv,
} from "./support/by-cli.js";

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const writeConfig = (root: string, taskPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

afterEach(cleanupTempRoots);

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid task prefix %s", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(true);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid task prefix %j", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(false);
  });

  it("initializes when .but-why exists without config", () => {
    const root = createGitRepo();

    mkdirSync(join(root, ".but-why"));
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("status: initialized");
    expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
      taskPrefix: "BY",
    });
  });

  it("fails when the reviewers path is a file", () => {
    const root = createGitRepo();

    writeConfig(root);
    writeFileSync(join(root, ".but-why/reviewers"), "not a directory");
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_repo_state
  message: .but-why/reviewers/ must be a directory.
  path: .but-why/reviewers/
help[1]: Move the conflicting path aside before running init again.`);
    expect(existsSync(join(root, ".but-why/reviewers"))).toBe(true);
  });

  it("records a repair when an existing state database lacks the init migration", () => {
    const root = createGitRepo();

    writeConfig(root);
    mkdirSync(join(root, ".git", "but-why"), { recursive: true });
    const database = new DatabaseSync(sharedStatePath(root));
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    database.close();

    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("status: repaired");
    expect(result.stdout).toContain("updated[2]: <git-common-dir>/but-why/state.sqlite,.gitignore");

    const repairedDatabase = new DatabaseSync(sharedStatePath(root));

    try {
      expect(repairedDatabase.prepare("SELECT name FROM schema_migrations").all()).toEqual([
        { name: "001_init" },
        { name: "002_tasks" },
        { name: "003_task_comments" },
        { name: "004_submit_preflight" },
        { name: "005_validation_workspace_setup" },
        { name: "006_validation_runs" },
        { name: "007_general_validation_tooling_errors" },
        { name: "008_drop_durable_validation_workspace_path" },
        { name: "009_failed_validation_run_status" },
        { name: "010_validation_finding_phase" },
        { name: "011_validation_finding_producer" },
        { name: "012_optional_finding_severity" },
        { name: "013_validation_prepare_phase" },
        { name: "014_task_context_snapshots" },
        { name: "015_changes_and_candidates" },
        { name: "016_change_base_ref" },
        { name: "017_shared_state_identity" },
        { name: "018_candidate_validation_runs" },
        { name: "019_task_approval" },
        { name: "020_task_dependencies" },
        { name: "021_task_starts" },
        { name: "022_change_owned_worktrees" },
      ]);
    } finally {
      repairedDatabase.close();
    }
  });

  it("adds Task approval state without losing existing Task-owned records", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const statePath = sharedStatePath(root);
    const database = new DatabaseSync(statePath);

    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(`
      INSERT INTO tasks (
        id, numeric_id, title, description, state, created_at, updated_at, branch
      ) VALUES (
        'BY-1', 1, 'Existing task', 'Existing description', 'todo',
        '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', 'feature/by-1'
      );
      INSERT INTO task_comments (id, task_id, created_at, content)
      VALUES ('comment-1', 'BY-1', '2026-07-02T00:00:00.000Z', 'Existing comment');
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at
      ) VALUES (
        'change-1', '/repo/.git', 'refs/heads/feature/by-1', 'BY-1', 'open',
        '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z'
      );
      INSERT INTO validation_runs (
        id, task_id, task_validation_number, status, branch, commit_sha,
        github_owner, github_repo, github_base_branch, github_remote_name,
        github_remote_url, created_at, updated_at
      ) VALUES (
        'by-1.v1', 'BY-1', 1, 'active', 'feature/by-1', 'abc123',
        'acme', 'widgets', 'main', 'origin', 'https://github.com/acme/widgets.git',
        '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z'
      );

      DELETE FROM schema_migrations WHERE name = '019_task_approval';
      DROP INDEX tasks_branch_unique_idx;
      CREATE TABLE tasks_old (
        id TEXT NOT NULL UNIQUE,
        numeric_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('todo', 'implementing', 'validating', 'needs_input', 'ready', 'done')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        branch TEXT
      );
      INSERT INTO tasks_old SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_old RENAME TO tasks;
      CREATE UNIQUE INDEX tasks_branch_unique_idx
      ON tasks (branch)
      WHERE branch IS NOT NULL;
    `);
    database.exec("PRAGMA foreign_keys = ON");
    database.close();

    const migrationResult = runBy(root, "init", "--task-prefix", "BY");

    expect(migrationResult.status).toBe(0);
    expect(migrationResult.stdout).toContain("status: repaired");

    const migrated = new DatabaseSync(statePath);

    try {
      expect(migrated.prepare("SELECT * FROM tasks WHERE id = 'BY-1'").get()).toMatchObject({
        id: "BY-1",
        numeric_id: 1,
        title: "Existing task",
        description: "Existing description",
        state: "todo",
        branch: "feature/by-1",
      });
      expect(
        migrated.prepare("SELECT content FROM task_comments WHERE task_id = 'BY-1'").get(),
      ).toEqual({
        content: "Existing comment",
      });
      expect(migrated.prepare("SELECT id FROM changes WHERE task_id = 'BY-1'").get()).toEqual({
        id: "change-1",
      });
      expect(
        migrated.prepare("SELECT id FROM validation_runs WHERE task_id = 'BY-1'").get(),
      ).toEqual({
        id: "by-1.v1",
      });
      expect(
        migrated
          .prepare("SELECT name FROM schema_migrations WHERE name = '019_task_approval'")
          .all(),
      ).toEqual([{ name: "019_task_approval" }]);
      expect(migrated.prepare("PRAGMA foreign_key_list(task_comments)").all()).toContainEqual(
        expect.objectContaining({ table: "tasks" }),
      );
      expect(() =>
        migrated
          .prepare(`
            INSERT INTO tasks (
              id, numeric_id, title, description, state, created_at, updated_at, branch
            ) VALUES ('BY-2', 2, 'Duplicate branch', 'Description', 'new', 'now', 'now', 'feature/by-1')
          `)
          .run(),
      ).toThrow();
      expect(() =>
        migrated
          .prepare(`
            INSERT INTO tasks (
              id, numeric_id, title, description, state, created_at, updated_at
            ) VALUES ('BY-3', 3, 'New task', 'Description', 'new', 'now', 'now')
          `)
          .run(),
      ).not.toThrow();
    } finally {
      migrated.close();
    }

    expect(runBy(root, "init", "--task-prefix", "BY").stdout).toContain("status: unchanged");
  });

  it("records migration timestamps from BUT_WHY_NOW", () => {
    const root = createGitRepo();
    const now = "2026-07-06T01:02:03.004Z";
    const result = runByWithEnv(root, { BUT_WHY_NOW: now }, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const database = new DatabaseSync(sharedStatePath(root));

    try {
      expect(
        database.prepare("SELECT DISTINCT applied_at AS appliedAt FROM schema_migrations").all(),
      ).toEqual([{ appliedAt: now }]);
    } finally {
      database.close();
    }
  });

  it("is unchanged when an existing state database already has the init migration", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("status: unchanged");
  });
});
