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

const withDatabase = <Result>(path: string, work: (database: DatabaseSync) => Result): Result => {
  const database = new DatabaseSync(path);
  try {
    return work(database);
  } finally {
    database.close();
  }
};

const insertTaskValidationRun = (
  database: DatabaseSync,
  input: {
    readonly title: string;
    readonly description: string;
    readonly state: "new" | "todo";
    readonly branch: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): void => {
  database
    .prepare(
      `INSERT INTO tasks (
        id, numeric_id, title, description, state, created_at, updated_at, branch
      ) VALUES ('BY-1', 1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.description,
      input.state,
      input.createdAt,
      input.updatedAt,
      input.branch,
    );
  database
    .prepare(
      `INSERT INTO validation_runs (
        id, task_id, task_validation_number, status, branch, commit_sha,
        github_owner, github_repo, github_base_branch, github_remote_name,
        github_remote_url, created_at, updated_at
      ) VALUES (
        'by-1.v1', 'BY-1', 1, 'active', ?, 'abc123',
        'acme', 'widgets', 'main', 'origin', 'https://github.com/acme/widgets.git', ?, ?
      )`,
    )
    .run(input.branch, input.updatedAt, input.updatedAt);
};

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
        { name: "022_rename_acceptance_review_phase" },
      ]);
    } finally {
      repairedDatabase.close();
    }
  });

  it("moves historical Task Start worktree facts onto the Change", () => {
    const root = createGitRepo();
    writeConfig(root);
    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    withDatabase(sharedStatePath(root), (database) =>
      database.exec(`
      DROP INDEX changes_worktree_path_unique_idx;
      ALTER TABLE changes DROP COLUMN prepare_failure;
      ALTER TABLE changes DROP COLUMN prepare_timeout_seconds;
      ALTER TABLE changes DROP COLUMN prepare_command;
      ALTER TABLE changes DROP COLUMN readiness;
      ALTER TABLE changes DROP COLUMN acceptance_context;
      ALTER TABLE changes DROP COLUMN worktree_path;
      ALTER TABLE changes DROP COLUMN starting_commit;

      CREATE TABLE task_starts (
        task_id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL UNIQUE,
        branch_ref TEXT NOT NULL UNIQUE,
        base_ref TEXT NOT NULL,
        starting_commit TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        acceptance_context TEXT NOT NULL,
        provisioning_state TEXT NOT NULL CHECK (provisioning_state IN ('pending', 'ready')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (change_id) REFERENCES changes(id)
      );

      INSERT INTO tasks (
        id, numeric_id, title, description, state, created_at, updated_at, branch
      ) VALUES (
        'BY-1', 1, 'Historical', 'Existing work', 'implementing',
        '2026-06-30T12:00:00.000Z', '2026-06-30T12:00:00.000Z', NULL
      );
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, task_id, state,
        close_reason, created_at, updated_at, closed_at, base_ref
      ) VALUES (
        'change-1', '/repo/.git', 'refs/heads/but-why/by-1', 'BY-1', 'open',
        NULL, '2026-06-30T12:00:00.000Z', '2026-06-30T12:00:00.000Z', NULL,
        'refs/heads/main'
      );
      INSERT INTO task_starts (
        task_id, change_id, branch_ref, base_ref, starting_commit, worktree_path,
        acceptance_context, provisioning_state, created_at, updated_at
      ) VALUES (
        'BY-1', 'change-1', 'refs/heads/but-why/by-1', 'refs/heads/main',
        '1111111111111111111111111111111111111111', '/repo/worktree',
        '{"version":1,"title":"Historical","description":"Existing work","comments":[]}',
        'ready', '2026-06-30T12:00:00.000Z', '2026-06-30T12:00:00.000Z'
      );
      DELETE FROM schema_migrations WHERE name = '022_change_owned_worktrees';
    `),
    );

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    withDatabase(sharedStatePath(root), (migrated) => {
      expect(
        migrated
          .prepare(`
            SELECT starting_commit AS startingCommit, worktree_path AS worktreePath,
                   acceptance_context AS acceptanceContext, readiness
            FROM changes WHERE id = 'change-1'
          `)
          .get(),
      ).toEqual({
        startingCommit: "1111111111111111111111111111111111111111",
        worktreePath: "/repo/worktree",
        acceptanceContext:
          '{"version":1,"title":"Historical","description":"Existing work","comments":[]}',
        readiness: "ready",
      });
      expect(
        migrated.prepare("SELECT name FROM sqlite_master WHERE name = 'task_starts'").get(),
      ).toBeUndefined();
    });
  });

  it("adds Task approval state without losing existing Task-owned records", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const statePath = sharedStatePath(root);
    const database = new DatabaseSync(statePath);

    database.exec("PRAGMA foreign_keys = OFF");
    insertTaskValidationRun(database, {
      title: "Existing task",
      description: "Existing description",
      state: "todo",
      branch: "feature/by-1",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    database.exec(`
      INSERT INTO task_comments (id, task_id, created_at, content)
      VALUES ('comment-1', 'BY-1', '2026-07-02T00:00:00.000Z', 'Existing comment');
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at
      ) VALUES (
        'change-1', '/repo/.git', 'refs/heads/feature/by-1', 'BY-1', 'open',
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

  it("renames legacy Acceptance Review phase storage", () => {
    const root = createGitRepo();
    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const statePath = sharedStatePath(root);
    const database = new DatabaseSync(statePath);

    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(`
      DELETE FROM schema_migrations WHERE name = '022_rename_acceptance_review_phase';
      CREATE TABLE validation_run_phase_statuses_legacy (
        validation_run_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('preflight', 'prepare', 'checks', 'intent_review', 'quality_review', 'publish_pr', 'watch_pr')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'passed', 'failed', 'skipped', 'workflow_failed')),
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (validation_run_id, phase),
        FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id)
      );
      DROP TABLE validation_run_phase_statuses;
      ALTER TABLE validation_run_phase_statuses_legacy RENAME TO validation_run_phase_statuses;
    `);
    insertTaskValidationRun(database, {
      title: "Legacy review",
      description: "Legacy review",
      state: "new",
      branch: "feature/by-1",
      createdAt: "now",
      updatedAt: "now",
    });
    database.exec(`
      INSERT INTO validation_run_phase_statuses
      VALUES ('by-1.v1', 'intent_review', 'passed', NULL, 'now', 'now');

      INSERT INTO changes (
        id, repository_common_directory, branch_ref, state, created_at, updated_at
      ) VALUES ('change-1', '/repo/.git', 'refs/heads/feature', 'open', 'now', 'now');
      INSERT INTO candidates (
        id, change_id, selected_base_ref, resolved_target_sha,
        comparison_base_sha, head_sha, created_at
      ) VALUES ('candidate-1', 'change-1', 'refs/heads/main', 'base', 'base', 'head', 'now');
      INSERT INTO candidate_validation_runs (
        id, candidate_id, policy_snapshot, state, created_at, updated_at
      ) VALUES ('candidate-run', 'candidate-1', '{}', 'running', 'now', 'now');
      INSERT INTO candidate_validation_rounds
      VALUES ('candidate-run', 'intent_review', 'acceptance', 1, 'passed', 'now');
      INSERT INTO candidate_validation_artifacts (
        ref, validation_run_id, phase, producer, path, created_at
      ) VALUES (
        'artifact:candidate-run/intent_review/acceptance/stdout.txt',
        'candidate-run', 'intent_review', 'acceptance',
        'candidate-run/intent_review/acceptance/stdout.txt', 'now'
      );
      INSERT INTO candidate_validation_findings (
        id, validation_run_id, phase, producer, title, description, severity,
        evidence, files, artifact_refs, created_at, updated_at
      ) VALUES (
        'finding-1', 'candidate-run', 'intent_review', 'acceptance', 'Legacy',
        'Legacy', 'low', 'Legacy', '[]',
        '["artifact:candidate-run/intent_review/acceptance/stdout.txt"]', 'now', 'now'
      );
    `);
    database.exec("PRAGMA foreign_keys = ON");
    database.close();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const migrated = new DatabaseSync(statePath);

    try {
      expect(migrated.prepare("SELECT phase FROM validation_run_phase_statuses").get()).toEqual({
        phase: "acceptance_review",
      });
      expect(migrated.prepare("SELECT phase FROM candidate_validation_rounds").get()).toEqual({
        phase: "acceptance_review",
      });
      expect(
        migrated.prepare("SELECT phase, ref, path FROM candidate_validation_artifacts").get(),
      ).toEqual({
        phase: "acceptance_review",
        ref: "artifact:candidate-run/acceptance_review/acceptance/stdout.txt",
        path: "candidate-run/acceptance_review/acceptance/stdout.txt",
      });
      expect(
        migrated
          .prepare("SELECT phase, artifact_refs AS artifactRefs FROM candidate_validation_findings")
          .get(),
      ).toEqual({
        phase: "acceptance_review",
        artifactRefs: '["artifact:candidate-run/acceptance_review/acceptance/stdout.txt"]',
      });
      expect(
        migrated
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'validation_run_phase_statuses'",
          )
          .get(),
      ).toMatchObject({ sql: expect.stringContaining("'acceptance_review'") });
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
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
