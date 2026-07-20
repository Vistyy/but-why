import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, describe, it as ordinaryIt } from "vitest";

import { collapseHome, mapRuntimeError } from "../src/cli.js";
import { butWhyGitignoreBlock } from "../src/init/gitignore.js";
import { encodeToon } from "../src/output/toon.js";
import {
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  repoRoot,
  runByInProcessEffect,
  runJustBy,
} from "./support/by-cli.js";

const expectedBin = collapseHome(join(repoRoot, "bin/by"));
const expectedConfigDoc = join(repoRoot, "docs/public/config.md");
const expectedSetupDoc = join(repoRoot, "docs/public/setup.md");
const managedGitignoreBlock = `${butWhyGitignoreBlock}\n`;
const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

afterEach(cleanupTempRoots);

describe("by CLI", () => {
  ordinaryIt(
    "prints not_initialized for bare just by before setup without touching the repo root",
    () => {
      const result = runJustBy();

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: not_initialized
  message: This workspace is not initialized for But Why?.
help[1]: Run \`by init --task-prefix BY\` in the repository root.`);
    },
  );

  it.effect("prints the help view", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
usage: "by [--output <format>] [command] [--help]"
commands[9]{command,description}:
  by,Show workspace task dashboard
  by init --task-prefix <prefix>,Create repo-local But Why? state
  by task create --title <title> --description-file <file>,Create a repo-local Task
  "by task list [--all] [--state <state>]",List repo-local Tasks
  "by change start [--task <task-id>]",Create a prepared Change worktree
  "by change reconcile [<change-id>]",Read owned pull requests and clean terminal Changes
  "by change implement <change-id> [--handoff-file <path>]",Launch a fresh Interactive Session in a ready Change worktree
  by submit <task-id>,Create a Validation Run from submit preflight
  by validation-run show <validation-run-id>,Show full Validation Run details
flags[3]{flag,description}:
  "--output <format>","Set stdout format: toon or json. Default: toon."
  "-o <format>","Alias for --output <format>. Valid values: toon, json."
  "--help",Show this help
docs[2]{name,path}:
  setup,${expectedSetupDoc}
  config,${expectedConfigDoc}`);
    }),
  );

  it.effect("prints JSON help when selected before the command", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--output", "json", "--help"]);

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
      expect(parsed.commands).toHaveLength(9);
      expect(parsed.flags).toHaveLength(3);
    }),
  );

  it.effect("prints JSON init help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--output", "json", "init", "--help"]);

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
    }),
  );

  it.effect("prints JSON init guidance", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, [
        "--output",
        "json",
        "init",
        "--task-prefix",
        "BY",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        validationSetup: {
          policyFile: ".but-why/config.json",
          policy: "tracked repo policy",
          configDoc: expectedConfigDoc,
          setupDoc: expectedSetupDoc,
          guidance: [
            {
              step: "inspect",
              detail: "Inspect repo tooling before choosing validation commands.",
            },
            {
              step: "configure",
              detail:
                "Configure top-level prepare and validation.checks to the best of your ability from observed tooling.",
            },
            { step: "review", detail: "Keep .but-why/config.json explicit and reviewable." },
          ],
        },
      });
    }),
  );

  it.effect("prints JSON help when selected after the command", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help", "-o", "json"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).usage).toBe("by [--output <format>] [command] [--help]");
    }),
  );

  it.effect("keeps TOON output when selected explicitly", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["-o", "toon", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain('usage: "by [--output <format>] [command] [--help]"');
      expect(() => JSON.parse(result.stdout)).toThrow();
    }),
  );

  it.effect("prints JSON usage errors after a valid JSON selector", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--output", "json", "--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "unknown_flag",
          message: "Unknown flag: --bad",
        },
        help: ["Run `by --help`"],
      });
    }),
  );

  it.effect("prints JSON command errors after a valid JSON selector", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["--output", "json", "task", "list"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "not_initialized",
          message: "This workspace is not initialized for But Why?.",
        },
        help: ["Run `by init --task-prefix BY` in the repository root."],
      });
    }),
  );

  it.effect("prints invalid output selectors as TOON usage errors", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--output", "xml", "--help"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_output_format
  message: "Invalid output format: xml"
  valid[2]: toon,json
help[1]: Use --output toon or --output json.`);
    }),
  );

  it.effect("prints missing output selector values as TOON usage errors", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "list", "--output"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_output_format
  message: Missing output format after --output.
  valid[2]: toon,json
help[1]: Use --output toon or --output json.`);
    }),
  );

  it.effect("prints duplicate output selectors as TOON usage errors", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, [
        "--output",
        "json",
        "--help",
        "-o",
        "toon",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: duplicate_output_selector
  message: Only one output selector is allowed.
help[1]: "Use either --output <format> or -o <format>, not both."`);
    }),
  );

  it.effect("prints the init help view", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["init", "--help"]);

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
    }),
  );

  it.effect("prints a structured unknown command usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["frobnicate"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: unknown_command
  message: "Unknown command: frobnicate"
help[1]: Run \`by --help\``);
    }),
  );

  it.effect("prints a structured unknown flag usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: unknown_flag
  message: "Unknown flag: --bad"
help[1]: Run \`by --help\``);
    }),
  );

  it.effect("initializes the Git work tree root", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`init:
  status: initialized
  root: ${root}
  taskPrefix: BY
created[3]: .but-why/config.json,<git-common-dir>/but-why/state.sqlite,.but-why/reviewers/
updated[1]: .gitignore
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure top-level prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        taskPrefix: "BY",
      });
      expect(existsSync(sharedStatePath(root))).toBe(true);
      expect(readdirSync(join(root, ".but-why/reviewers"))).toEqual([]);
      expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
      expectInitializedSchema(root);
      expect(
        spawnSync("git", ["check-ignore", "-q", ".but-why/config.json"], { cwd: root }).status,
      ).toBe(1);
      expect(
        spawnSync("git", ["check-ignore", "-q", ".but-why/reviewers/"], { cwd: root }).status,
      ).toBe(1);
    }),
  );

  it.effect("initializes the root when run from a subdirectory", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const subdirectory = join(root, "packages/app");
      mkdirSync(subdirectory, { recursive: true });

      const result = yield* runByInProcessEffect(subdirectory, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`root: ${root}`);
      expect(existsSync(join(root, ".but-why/config.json"))).toBe(true);
      expect(existsSync(join(subdirectory, ".but-why/config.json"))).toBe(false);
    }),
  );

  const expectInitializedSchema = (root: string): void => {
    const database = new DatabaseSync(sharedStatePath(root));

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
        { name: "015_changes_and_candidates" },
        { name: "016_change_base_ref" },
        { name: "017_shared_state_identity" },
        { name: "018_candidate_validation_runs" },
        { name: "019_task_approval" },
        { name: "020_task_dependencies" },
        { name: "021_task_starts" },
        { name: "022_change_owned_worktrees" },
        { name: "023_align_reviewer_phase_names" },
        { name: "024_change_owned_pull_requests" },
        { name: "025_change_cleanup" },
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "candidate_validation_artifacts" },
        { name: "candidate_validation_findings" },
        { name: "candidate_validation_rounds" },
        { name: "candidate_validation_runs" },
        { name: "candidate_validation_tooling_failures" },
        { name: "candidate_validation_workspace_setups" },
        { name: "candidates" },
        { name: "changes" },
        { name: "schema_migrations" },
        { name: "shared_state_identity" },
        { name: "task_comments" },
        { name: "task_dependencies" },
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
  };

  it.effect("prints unchanged when init is rerun without repairs", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

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
    configure,Configure top-level prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
    }),
  );

  it.effect("repairs missing generated artifacts", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      rmSync(sharedStatePath(root));
      rmSync(join(root, ".gitignore"));
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`init:
  status: repaired
  root: ${root}
  taskPrefix: BY
created[1]: <git-common-dir>/but-why/state.sqlite
updated[1]: .gitignore
validationSetup:
  policyFile: .but-why/config.json
  policy: tracked repo policy
  configDoc: ${expectedConfigDoc}
  setupDoc: ${expectedSetupDoc}
  guidance[3]{step,detail}:
    inspect,Inspect repo tooling before choosing validation commands.
    configure,Configure top-level prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
    }),
  );

  it.effect("repairs the missing reviewers directory", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      rmSync(join(root, ".but-why/reviewers"), { recursive: true });
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

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
    configure,Configure top-level prepare and validation.checks to the best of your ability from observed tooling.
    review,Keep .but-why/config.json explicit and reviewable.`);
    }),
  );

  it.effect("prints not_git_work_tree outside Git", () =>
    Effect.gen(function* () {
      const root = createTempRoot();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: not_git_work_tree
  message: by init must be run inside a Git work tree.
help[1]: "Run git init first, or cd into an existing Git repository."`);
    }),
  );

  it.effect("prints missing_task_prefix in non-interactive init", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: missing_task_prefix
  message: "--task-prefix is required in non-interactive init."
help[1]: Run by init --task-prefix BY.`);
    }),
  );

  it.effect("prints invalid_task_prefix", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "by"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_task_prefix
  message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$."
  taskPrefix: by
help[1]: "Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY."`);
    }),
  );

  it.effect("prints task_prefix_conflict", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "OLD"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: task_prefix_conflict
  message: Repository is already initialized with task prefix OLD.
  path: .but-why/config.json
  existingTaskPrefix: OLD
  requestedTaskPrefix: BY
help[1]: "Keep using OLD, or manually migrate .but-why/config.json before running init again."`);
    }),
  );

  it.effect("prints invalid_repo_config for malformed config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      writeFileSync(join(root, ".but-why/config.json"), "{");
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_repo_config");
      expect(result.stdout).toContain("expected: valid JSON");
      expect(result.stdout).toContain('actual: "{"');
      expect(result.stdout).toContain("Invalid JSON:");
    }),
  );

  it.effect("prints invalid_repo_config for wrong config schema", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      writeFileSync(
        join(root, ".but-why/config.json"),
        JSON.stringify({ taskPrefix: "BY", extra: true }),
      );
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_repo_config");
      expect(result.stdout).toContain("path[1]: extra");
      expect(result.stdout).toContain("actual: true");
      expect(result.stdout).toContain("message: Unknown key.");
    }),
  );

  ordinaryIt("maps runtime errors without leaking stack traces", () => {
    expect(encodeToon(mapRuntimeError().stdout)).toBe(`error:
  code: internal_error
  message: The command failed unexpectedly
help[1]: Report this failure with the command and workspace path`);
  });

  ordinaryIt("collapses the home directory in executable paths", () => {
    expect(collapseHome(join(homedir(), ".local/bin/by"))).toBe("~/.local/bin/by");
    expect(expectedBin).toBe(collapseHome(join(repoRoot, "bin/by")));
  });
});
