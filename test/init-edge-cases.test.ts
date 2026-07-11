import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { butWhyGitignoreBlock } from "../src/init/gitignore.js";
import {
  cleanupTempRoots,
  createGitRepo,
  runByInProcessArgs as runBy,
  runByWithEnv,
} from "./support/by-cli.js";

const managedGitignoreBlock = `${butWhyGitignoreBlock}\n`;

const writeConfig = (root: string, taskPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

const countButWhyHeaders = (content: string) => content.match(/^# But Why\?$/gm)?.length ?? 0;

afterEach(cleanupTempRoots);

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid task prefix %s", (taskPrefix) => {
    const root = createGitRepo();
    const result = runBy(root, "init", "--task-prefix", taskPrefix);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`taskPrefix: ${taskPrefix}`);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid task prefix %j", (taskPrefix) => {
    const root = createGitRepo();
    const result = runBy(root, "init", "--task-prefix", taskPrefix);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("code: invalid_task_prefix");
    expect(result.stdout).toContain(`taskPrefix: ${taskPrefix}`);
  });

  it.each([
    ["missing taskPrefix", {}],
    ["non-string taskPrefix", { taskPrefix: 123 }],
    ["invalid existing taskPrefix", { taskPrefix: "B" }],
    ["extra key", { taskPrefix: "BY", extra: true }],
    [
      "check severity",
      {
        taskPrefix: "BY",
        validation: { checks: [{ id: "quality", command: "true", severity: "high" }] },
      },
    ],
    ["prepare severity", { taskPrefix: "BY", prepare: { severity: "high" } }],
    ["validation prepare without command", { taskPrefix: "BY", validation: { prepare: {} } }],
    [
      "validation prepare command array",
      { taskPrefix: "BY", validation: { prepare: { command: ["pnpm", "install"] } } },
    ],
    [
      "validation prepare commands array",
      { taskPrefix: "BY", validation: { prepare: { commands: ["pnpm install"] } } },
    ],
    [
      "validation prepare zero timeout",
      { taskPrefix: "BY", validation: { prepare: { command: "true", timeoutSeconds: 0 } } },
    ],
    [
      "validation prepare decimal timeout",
      { taskPrefix: "BY", validation: { prepare: { command: "true", timeoutSeconds: 1.5 } } },
    ],
    [
      "validation prepare extra key",
      { taskPrefix: "BY", validation: { prepare: { command: "true", severity: "high" } } },
    ],
  ])("rejects repo config with %s", (_name, config) => {
    const root = createGitRepo();

    mkdirSync(join(root, ".but-why"));
    writeFileSync(join(root, ".but-why/config.json"), JSON.stringify(config));
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("code: invalid_repo_config");
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
    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));
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
    expect(result.stdout).toContain("updated[2]: .but-why/state.sqlite,.gitignore");

    const repairedDatabase = new DatabaseSync(join(root, ".but-why/state.sqlite"));

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
      ]);
    } finally {
      repairedDatabase.close();
    }
  });

  it("records migration timestamps from BUT_WHY_NOW", () => {
    const root = createGitRepo();
    const now = "2026-07-06T01:02:03.004Z";
    const result = runByWithEnv(root, { BUT_WHY_NOW: now }, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

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

  it("normalizes duplicate managed gitignore blocks to one block", () => {
    const root = createGitRepo();

    writeFileSync(
      join(root, ".gitignore"),
      `node_modules/\n\n${managedGitignoreBlock}\ndist/\n\n${managedGitignoreBlock}`,
    );

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(countButWhyHeaders(gitignore)).toBe(1);
    expect(gitignore).toBe(`node_modules/\n\ndist/\n\n${managedGitignoreBlock}`);
  });

  it("normalizes a managed gitignore block without a trailing newline", () => {
    const root = createGitRepo();

    writeFileSync(join(root, ".gitignore"), managedGitignoreBlock.trimEnd());

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
  });

  it("normalizes an incomplete managed gitignore block surrounded by other entries", () => {
    const root = createGitRepo();

    writeFileSync(
      join(root, ".gitignore"),
      "node_modules/\n\n# But Why?\n.but-why/state.sqlite\n\ndist/\n",
    );

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(countButWhyHeaders(gitignore)).toBe(1);
    expect(gitignore).toBe(`node_modules/\n\ndist/\n\n${managedGitignoreBlock}`);
  });
});
