import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { collapseHome, mapRuntimeError } from "../src/cli.js";
import { encodeToon } from "../src/output/toon.js";
import {
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  repoRoot,
  runByInProcessArgs as runBy,
  runJustBy,
} from "./support/by-cli.js";

const expectedBin = collapseHome(join(repoRoot, "bin/by"));

afterEach(cleanupTempRoots);

describe("by CLI", () => {
  it("prints not_initialized for bare just by before setup", () => {
    const result = runJustBy();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: not_initialized
  message: This workspace is not initialized for But Why?.
help[1]: Run \`by init --task-prefix BY\` in the repository root.`);
  });

  it("prints the help view", () => {
    const result = runBy(repoRoot, "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
usage: "by [command] [--help]"
commands[4]{command,description}:
  by,Show workspace task dashboard
  by init --task-prefix <prefix>,Create repo-local But Why? state
  by task create --title <title> --description-file <file>,Create a repo-local Task
  "by task list [--all] [--state <state>]",List repo-local Tasks
flags[1]{flag,description}:
  "--help",Show this help`);
  });

  it("prints the init help view", () => {
    const result = runBy(repoRoot, "init", "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`usage: by init --task-prefix <prefix>
flags[2]{flag,description}:
  "--task-prefix <prefix>",Required task ID prefix such as BY
  "--help",Show this help
examples[1]: by init --task-prefix BY`);
  });

  it("prints a structured unknown command usage error", () => {
    const result = runBy(repoRoot, "frobnicate");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: unknown_command
  message: "Unknown command: frobnicate"
help[1]: Run \`by --help\``);
  });

  it("prints a structured unknown flag usage error", () => {
    const result = runBy(repoRoot, "--bad");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: unknown_flag
  message: "Unknown flag: --bad"
help[1]: Run \`by --help\``);
  });

  it("initializes the Git work tree root", () => {
    const root = createGitRepo();
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`init:
  status: initialized
  root: ${root}
  taskPrefix: BY
created[3]: .but-why/config.json,.but-why/state.sqlite,.but-why/reviewers/
updated[1]: .gitignore`);
    expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
      taskPrefix: "BY",
    });
    expect(existsSync(join(root, ".but-why/state.sqlite"))).toBe(true);
    expect(readdirSync(join(root, ".but-why/reviewers"))).toEqual([]);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `# But Why?\n.but-why/state.sqlite\n.but-why/state.sqlite-*\n`,
    );
  });

  it("initializes the root when run from a subdirectory", () => {
    const root = createGitRepo();
    const subdirectory = join(root, "packages/app");
    mkdirSync(subdirectory, { recursive: true });

    const result = runBy(subdirectory, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`root: ${root}`);
    expect(existsSync(join(root, ".but-why/config.json"))).toBe(true);
    expect(existsSync(join(subdirectory, ".but-why/config.json"))).toBe(false);
  });

  it("creates SQLite migration metadata and task storage", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(database.prepare("SELECT name FROM schema_migrations").all()).toEqual([
        { name: "001_init" },
        { name: "002_tasks" },
        { name: "003_task_comments" },
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([{ name: "schema_migrations" }, { name: "task_comments" }, { name: "tasks" }]);
    } finally {
      database.close();
    }
  });

  it("keeps config and reviewers trackable", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    expect(
      spawnSync("git", ["check-ignore", "-q", ".but-why/config.json"], { cwd: root }).status,
    ).toBe(1);
    expect(
      spawnSync("git", ["check-ignore", "-q", ".but-why/reviewers/"], { cwd: root }).status,
    ).toBe(1);
  });

  it("prints unchanged when init is rerun without repairs", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`init:
  status: unchanged
  root: ${root}
  taskPrefix: BY`);
  });

  it("repairs missing generated artifacts", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    rmSync(join(root, ".but-why/state.sqlite"));
    rmSync(join(root, ".gitignore"));
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`init:
  status: repaired
  root: ${root}
  taskPrefix: BY
created[1]: .but-why/state.sqlite
updated[1]: .gitignore`);
  });

  it("repairs the missing reviewers directory", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    rmSync(join(root, ".but-why/reviewers"), { recursive: true });
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`init:
  status: repaired
  root: ${root}
  taskPrefix: BY
created[1]: .but-why/reviewers/`);
  });

  it("does not duplicate the managed gitignore block", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `# But Why?\n.but-why/state.sqlite\n.but-why/state.sqlite-*\n`,
    );
  });

  it("appends the managed gitignore block after existing content", () => {
    const root = createGitRepo();

    writeFileSync(join(root, ".gitignore"), "node_modules/\n");

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `node_modules/\n\n# But Why?\n.but-why/state.sqlite\n.but-why/state.sqlite-*\n`,
    );
  });

  it("repairs an incomplete managed gitignore block", () => {
    const root = createGitRepo();

    writeFileSync(join(root, ".gitignore"), "# But Why?\n.but-why/state.sqlite\n");

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `# But Why?\n.but-why/state.sqlite\n.but-why/state.sqlite-*\n`,
    );
  });

  it("prints not_git_work_tree outside Git", () => {
    const root = createTempRoot();
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: not_git_work_tree
  message: by init must be run inside a Git work tree.
help[1]: "Run git init first, or cd into an existing Git repository."`);
  });

  it("prints missing_task_prefix in non-interactive init", () => {
    const root = createGitRepo();
    const result = runBy(root, "init");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: missing_task_prefix
  message: "--task-prefix is required in non-interactive init."
help[1]: Run by init --task-prefix BY.`);
  });

  it("prints invalid_task_prefix", () => {
    const root = createGitRepo();
    const result = runBy(root, "init", "--task-prefix", "by");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_task_prefix
  message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$."
  taskPrefix: by
help[1]: "Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY."`);
  });

  it("prints task_prefix_conflict", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "OLD").status).toBe(0);
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: task_prefix_conflict
  message: Repository is already initialized with task prefix OLD.
  path: .but-why/config.json
  existingTaskPrefix: OLD
  requestedTaskPrefix: BY
help[1]: "Keep using OLD, or manually migrate .but-why/config.json before running init again."`);
  });

  it("prints invalid_repo_config for malformed config", () => {
    const root = createGitRepo();

    mkdirSync(join(root, ".but-why"));
    writeFileSync(join(root, ".but-why/config.json"), "{");
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_repo_config
  message: .but-why/config.json is not valid But Why? repo config.
  path: .but-why/config.json
help[1]: Fix the JSON or move the file aside before running init again.`);
  });

  it("prints invalid_repo_config for wrong config schema", () => {
    const root = createGitRepo();

    mkdirSync(join(root, ".but-why"));
    writeFileSync(
      join(root, ".but-why/config.json"),
      JSON.stringify({ taskPrefix: "BY", extra: true }),
    );
    const result = runBy(root, "init", "--task-prefix", "BY");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_repo_config
  message: .but-why/config.json is not valid But Why? repo config.
  path: .but-why/config.json
help[1]: Fix the JSON or move the file aside before running init again.`);
  });

  it("maps runtime errors without leaking stack traces", () => {
    expect(encodeToon(mapRuntimeError().stdout)).toBe(`error:
  code: internal_error
  message: The command failed unexpectedly
help[1]: Report this failure with the command and workspace path`);
  });

  it("collapses the home directory in executable paths", () => {
    expect(collapseHome(join(homedir(), ".local/bin/by"))).toBe("~/.local/bin/by");
    expect(expectedBin).toBe(collapseHome(join(repoRoot, "bin/by")));
  });
});
