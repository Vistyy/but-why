import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { collapseHome, mapRuntimeError } from "../src/cli.js";
import { butWhyGitignoreBlock } from "../src/init/gitignore.js";
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
const expectedConfigDoc = join(repoRoot, "docs/public/config.md");
const expectedSetupDoc = join(repoRoot, "docs/public/setup.md");
const managedGitignoreBlock = `${butWhyGitignoreBlock}\n`;

afterEach(cleanupTempRoots);

describe("by CLI", () => {
  it("prints not_initialized for bare just by before setup without touching the repo root", () => {
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
usage: "by [--output <format>] [command] [--help]"
commands[6]{command,description}:
  by,Show workspace task dashboard
  by init --task-prefix <prefix>,Create repo-local But Why? state
  by task create --title <title> --description-file <file>,Create a repo-local Task
  "by task list [--all] [--state <state>]",List repo-local Tasks
  by submit <task-id>,Create a Validation Run from submit preflight
  by validation-run show <validation-run-id>,Show full Validation Run details
flags[3]{flag,description}:
  "--output <format>","Set stdout format: toon or json. Default: toon."
  "-o <format>","Alias for --output <format>. Valid values: toon, json."
  "--help",Show this help
docs[2]{name,path}:
  setup,${expectedSetupDoc}
  config,${expectedConfigDoc}`);
  });

  it("prints JSON help when selected before the command", () => {
    const result = runBy(repoRoot, "--output", "json", "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd()).not.toContain("\n");
    const parsed = JSON.parse(result.stdout);

    expect(parsed).toMatchObject({
      bin: expectedBin,
      description: "Validate completed code changes against approved human intent.",
      usage: "by [--output <format>] [command] [--help]",
      docs: [
        { name: "setup", path: expectedSetupDoc },
        { name: "config", path: expectedConfigDoc },
      ],
    });
    expect(parsed.commands).toHaveLength(6);
    expect(parsed.flags).toHaveLength(3);
  });

  it("prints JSON init help", () => {
    const result = runBy(repoRoot, "--output", "json", "init", "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      usage: "by init --task-prefix <prefix>",
      description: "Create repo policy files and then guide validation setup.",
      flags: [
        { flag: "--task-prefix <prefix>", description: "Required task ID prefix such as BY" },
        {
          flag: "--output <format>",
          description: "Set stdout format: toon or json. Default: toon.",
        },
        {
          flag: "-o <format>",
          description: "Alias for --output <format>. Valid values: toon, json.",
        },
        { flag: "--help", description: "Show this help" },
      ],
      examples: ["by init --task-prefix BY"],
      docs: [
        { name: "setup", path: expectedSetupDoc },
        { name: "config", path: expectedConfigDoc },
      ],
    });
  });

  it("prints JSON init guidance", () => {
    const root = createGitRepo();
    const result = runBy(root, "--output", "json", "init", "--task-prefix", "BY");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      validationSetup: {
        policyFile: ".but-why/config.json",
        policy: "tracked repo policy",
        configDoc: expectedConfigDoc,
        setupDoc: expectedSetupDoc,
        guidance: [
          { step: "inspect", detail: "Inspect repo tooling before choosing validation commands." },
          {
            step: "configure",
            detail:
              "Configure validation.prepare and validation.checks to the best of your ability from observed tooling.",
          },
          { step: "review", detail: "Keep .but-why/config.json explicit and reviewable." },
        ],
      },
    });
  });

  it("prints JSON help when selected after the command", () => {
    const result = runBy(repoRoot, "--help", "-o", "json");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).usage).toBe("by [--output <format>] [command] [--help]");
  });

  it("keeps TOON output when selected explicitly", () => {
    const result = runBy(repoRoot, "-o", "toon", "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('usage: "by [--output <format>] [command] [--help]"');
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  it("prints JSON usage errors after a valid JSON selector", () => {
    const result = runBy(repoRoot, "--output", "json", "--bad");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      error: {
        code: "unknown_flag",
        message: "Unknown flag: --bad",
      },
      help: ["Run `by --help`"],
    });
  });

  it("prints JSON command errors after a valid JSON selector", () => {
    const root = createGitRepo();
    const result = runBy(root, "--output", "json", "task", "list");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      error: {
        code: "not_initialized",
        message: "This workspace is not initialized for But Why?.",
      },
      help: ["Run `by init --task-prefix BY` in the repository root."],
    });
  });

  it("prints invalid output selectors as TOON usage errors", () => {
    const result = runBy(repoRoot, "--output", "xml", "--help");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_output_format
  message: "Invalid output format: xml"
  valid[2]: toon,json
help[1]: Use --output toon or --output json.`);
  });

  it("prints missing output selector values as TOON usage errors", () => {
    const result = runBy(repoRoot, "task", "list", "--output");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_output_format
  message: Missing output format after --output.
  valid[2]: toon,json
help[1]: Use --output toon or --output json.`);
  });

  it("prints duplicate output selectors as TOON usage errors", () => {
    const result = runBy(repoRoot, "--output", "json", "--help", "-o", "toon");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: duplicate_output_selector
  message: Only one output selector is allowed.
help[1]: "Use either --output <format> or -o <format>, not both."`);
  });

  it("prints the init help view", () => {
    const result = runBy(repoRoot, "init", "--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`usage: by init --task-prefix <prefix>
description: Create repo policy files and then guide validation setup.
flags[4]{flag,description}:
  "--task-prefix <prefix>",Required task ID prefix such as BY
  "--output <format>","Set stdout format: toon or json. Default: toon."
  "-o <format>","Alias for --output <format>. Valid values: toon, json."
  "--help",Show this help
examples[1]: by init --task-prefix BY
docs[2]{name,path}:
  setup,${expectedSetupDoc}
  config,${expectedConfigDoc}`);
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
updated[1]: .gitignore
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure validation.prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
    expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
      taskPrefix: "BY",
    });
    expect(existsSync(join(root, ".but-why/state.sqlite"))).toBe(true);
    expect(readdirSync(join(root, ".but-why/reviewers"))).toEqual([]);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
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
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "schema_migrations" },
        { name: "task_comments" },
        { name: "tasks" },
        { name: "validation_run_artifacts" },
        { name: "validation_run_findings" },
        { name: "validation_run_logs" },
        { name: "validation_run_phase_statuses" },
        { name: "validation_run_rounds" },
        { name: "validation_run_token_usage" },
        { name: "validation_run_tooling_errors" },
        { name: "validation_runs" },
        { name: "validation_workspace_setups" },
      ]);
      expect(
        database
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'validation_run_phase_statuses'",
          )
          .get(),
      ).toEqual({
        sql: expect.stringContaining("'workflow_failed'"),
      });
      expect(
        database
          .prepare(
            "SELECT name FROM pragma_table_info('validation_run_tooling_errors') WHERE name = 'error_kind'",
          )
          .get(),
      ).toEqual({ name: "error_kind" });
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
  taskPrefix: BY
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure validation.prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
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
updated[1]: .gitignore
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure validation.prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
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
created[1]: .but-why/reviewers/
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure validation.prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
  });

  it("does not duplicate the managed gitignore block", () => {
    const root = createGitRepo();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
  });

  it("appends the managed gitignore block after existing content", () => {
    const root = createGitRepo();

    writeFileSync(join(root, ".gitignore"), "node_modules/\n");

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `node_modules/\n\n${managedGitignoreBlock}`,
    );
  });

  it("repairs an incomplete managed gitignore block", () => {
    const root = createGitRepo();

    writeFileSync(join(root, ".gitignore"), "# But Why?\n.but-why/state.sqlite\n");

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
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
    expect(result.stdout).toContain("code: invalid_repo_config");
    expect(result.stdout).toContain("expected: valid JSON");
    expect(result.stdout).toContain('actual: "{"');
    expect(result.stdout).toContain("Invalid JSON:");
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
    expect(result.stdout).toContain("code: invalid_repo_config");
    expect(result.stdout).toContain("path[1]: extra");
    expect(result.stdout).toContain("actual: true");
    expect(result.stdout).toContain("message: Unknown key.");
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
