import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";
import { collapseHome } from "../../src/cli/cliPath.js";
import { mapRuntimeError } from "../../src/cli.js";
import { butWhyGitignoreBlock } from "../../src/init/gitignore.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { createGitRepo, repoRoot, runByInProcessEffect } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const expectedConfigDoc = join(repoRoot, "docs/public/config.md");
const expectedSetupDoc = join(repoRoot, "docs/public/setup.md");
const managedGitignoreBlock = `${butWhyGitignoreBlock}\n`;
const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");
const expectedCommandPaths = [
  "init",
  "snapshot",
  "task create",
  "task dependencies add",
  "task dependencies remove",
  "task dependencies replace",
  "task dependencies clear",
  "task list",
  "task show",
  "task approve",
  "task context",
  "task context draft",
  "task context apply",
  "task cancel",
  "change start",
  "change prepare",
  "change list",
  "change show",
  "change findings",
  "change validation-runs",
  "change submit",
  "change cancel",
  "change reconcile",
  "change implement",
  "change decision add",
  "change decision list",
  "change blocker raise",
  "change blocker resolve",
  "change blocker list",
  "validation-run show",
  "validation-run artifact",
] as const;

const withRepositorySql = <A, E>(
  root: string,
  use: (repository: RepositorySql["Type"]) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    RepositorySql.pipe(
      Effect.flatMap(use),
      Effect.provide(
        repositorySqlLayer({
          statePath: sharedStatePath(root),
          commonDirectory: join(root, ".git"),
        }),
      ),
    ),
  );

describe("by CLI", () => {
  it.effect("prints the generated help view", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.help).toContain(
        "Validate completed code changes against approved human intent.",
      );
      expect(parsed.help).toContain("COMMANDS");
      for (const commandPath of expectedCommandPaths) {
        expect(parsed.help, commandPath).toContain(`- ${commandPath}`);
      }
      expect(parsed.help).not.toContain("task task");
      expect(parsed.help).not.toContain("change change");
      expect(parsed.help).toContain("(-h, --help)");
      expect(parsed.help).toContain("--version");
      expect(parsed.help).toContain("--wizard");
      expect(parsed.help).toContain("--completions");
      expect(parsed.help).toContain("--log-level");
    }),
  );

  it.effect("classifies Change Submit as a long-running command in generated help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["change", "submit", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain(
        "Validate and publish a Change. This is a long-running command.",
      );
    }),
  );

  it.effect("uses native help behavior for trailing arguments", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "--help", "extra"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("Manage repo-local Tasks.");
    }),
  );

  it.effect("uses native leaf help behavior for trailing arguments", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "list", "--help", "extra"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("List repo-local Tasks.");
    }),
  );

  it.effect("uses native help behavior for trailing options", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, [
        "task",
        "list",
        "--help",
        "--state",
        "bad",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("List repo-local Tasks.");
    }),
  );

  it.effect("frames default JSON help as one compact document", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd()).not.toContain("\n");
      expect(JSON.parse(result.stdout).help).toContain("COMMANDS");
    }),
  );

  it.effect("prints the package version as one compact JSON document", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--version"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe('{"version":"0.0.1"}\n');
      expect(JSON.parse(result.stdout)).toEqual({ version: "0.0.1" });
    }),
  );

  it.effect("prints JSON init help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["init", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.help).toContain("Create repo-local But Why? state.");
      expect(parsed.help).toContain("--task-prefix text");
    }),
  );

  it.effect("prints JSON init guidance", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

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

  it.effect("prints JSON usage errors by default", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_usage",
        },
        help: ["Run `by --help` for generated command help."],
      });
    }),
  );

  it.effect("prints JSON command errors by default", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["task", "list"]);

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

  it.effect("normalizes leaf parser failures to invalid usage", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "list", "--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "invalid_usage",
          message: "Received unknown argument: '--bad'",
        },
        help: ["Run `by --help` for generated command help."],
      });
    }),
  );

  it.effect("prints the init help view", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["init", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("Create repo-local But Why? state.");
    }),
  );

  it.effect("prints a structured unknown command usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["frobnicate"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_usage",
          message: expect.stringContaining("Invalid subcommand for by"),
        },
      });
    }),
  );

  it.effect("prints a structured unknown flag usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_usage",
          message: expect.stringContaining("Invalid subcommand for by"),
        },
      });
    }),
  );

  it.effect("initializes the Git work tree root", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        init: { status: "initialized", root, taskPrefix: "BY" },
        created: [
          ".but-why/config.json",
          "<git-common-dir>/but-why/state.sqlite",
          ".but-why/reviewers/",
        ],
        updated: [".gitignore"],
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
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        taskPrefix: "BY",
      });
      expect(existsSync(sharedStatePath(root))).toBe(true);
      expect(readdirSync(join(root, ".but-why/reviewers"))).toEqual([]);
      expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(managedGitignoreBlock);
      yield* expectInitializedSchema(root);
      expect(
        runTestProcess("git", ["check-ignore", "-q", ".but-why/config.json"], {
          cwd: root,
        }).status,
      ).toBe(1);
      expect(
        runTestProcess("git", ["check-ignore", "-q", ".but-why/reviewers/"], {
          cwd: root,
        }).status,
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
      expect(JSON.parse(result.stdout)).toMatchObject({ init: { root } });
      expect(existsSync(join(root, ".but-why/config.json"))).toBe(true);
      expect(existsSync(join(subdirectory, ".but-why/config.json"))).toBe(false);
    }),
  );

  const expectInitializedSchema = (root: string) =>
    withRepositorySql(root, (repository) =>
      repository
        .operation(
          "inspect initialized schema",
          (sql) => sql<{ readonly name: string }>`
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
          `,
        )
        .pipe(
          Effect.tap((rows) => {
            expect(rows).toEqual([
              { name: "active_validation_runs" },
              { name: "candidate_validation_admissions" },
              { name: "candidate_validation_artifacts" },
              { name: "candidate_validation_findings" },
              { name: "candidate_validation_rounds" },
              { name: "candidate_validation_runs" },
              { name: "candidate_validation_tooling_failures" },
              { name: "candidate_validation_workspace_setups" },
              { name: "candidates" },
              { name: "changes" },
              { name: "effect_sql_migrations" },
              { name: "implementation_blockers" },
              { name: "implementation_decisions" },
              { name: "reviewer_sessions" },
              { name: "reviewer_transcripts" },
              { name: "shared_state_identity" },
              { name: "task_dependencies" },
              { name: "tasks" },
            ]);
          }),
        ),
    );

  it.effect("prints unchanged when init is rerun without repairs", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        init: { status: "unchanged", root, taskPrefix: "BY" },
        validationSetup: {
          policyFile: ".but-why/config.json",
          policy: "tracked repo policy",
          configDoc: expectedConfigDoc,
          setupDoc: expectedSetupDoc,
        },
      });
      const migrations = yield* withRepositorySql(root, (repository) =>
        repository.operation(
          "inspect repository migrations",
          (sql) => sql<{ readonly migration_id: number; readonly name: string }>`
            SELECT migration_id, name
            FROM effect_sql_migrations
            ORDER BY migration_id
          `,
        ),
      );
      expect(migrations).toEqual([
        { migration_id: 1, name: "baseline" },
        { migration_id: 2, name: "reviewer_sessions" },
        { migration_id: 3, name: "implementation_decisions" },
        { migration_id: 4, name: "implementation_blockers" },
        { migration_id: 5, name: "acceptance_context_versions" },
        { migration_id: 6, name: "reconcile_implementation_blocker_storage" },
        { migration_id: 7, name: "reviewer_sessions_per_producer" },
        { migration_id: 8, name: "recover_published_remote_branch_cleanup" },
        { migration_id: 9, name: "active_validation_runs" },
        { migration_id: 10, name: "validation_workspace_paths" },
        { migration_id: 11, name: "candidate_publications" },
        { migration_id: 12, name: "structured_implementation_decisions" },
        { migration_id: 13, name: "remove_no_change_completion" },
        { migration_id: 14, name: "remove_change_readiness" },
        { migration_id: 15, name: "remove_acceptance_context_versions" },
        { migration_id: 16, name: "remove_implementation_decision_content" },
        { migration_id: 17, name: "validation_run_blocker_identity" },
        { migration_id: 18, name: "remove_finding_severity" },
        { migration_id: 19, name: "simplify_reviewer_sessions" },
        { migration_id: 20, name: "remove_candidate_publications" },
        { migration_id: 21, name: "reviewer_transcripts" },
        { migration_id: 22, name: "change_cancel_reason" },
        { migration_id: 23, name: "restrict_lifecycle_states" },
        { migration_id: 24, name: "remove_task_comments" },
        { migration_id: 25, name: "repair_validation_policy_snapshot_ok_field" },
        { migration_id: 26, name: "current_candidate_validation_admissions" },
      ]);
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
      expect(JSON.parse(result.stdout)).toMatchObject({
        init: { status: "repaired", root, taskPrefix: "BY" },
        created: ["<git-common-dir>/but-why/state.sqlite"],
        updated: [".gitignore"],
      });
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
      expect(JSON.parse(result.stdout)).toMatchObject({
        init: { status: "repaired", root, taskPrefix: "BY" },
        created: [".but-why/reviewers/"],
      });
    }),
  );

  it.effect("prints not_git_work_tree outside Git", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "not_git_work_tree",
          message: "by init must be run inside a Git work tree.",
        },
        help: ["Run git init first, or cd into an existing Git repository."],
      });
    }),
  );

  it.effect("prints invalid_usage for missing task prefix in non-interactive init", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "invalid_usage",
          message: "Expected to find option: '--task-prefix'",
        },
        help: ["Run `by --help` for generated command help."],
      });
    }),
  );

  it.effect("prints invalid_task_prefix", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "by"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "invalid_task_prefix",
          message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$.",
          taskPrefix: "by",
        },
        help: ["Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY."],
      });
    }),
  );

  it.effect("prints task_prefix_conflict", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "OLD"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "task_prefix_conflict",
          message: "Repository is already initialized with task prefix OLD.",
          path: ".but-why/config.json",
          existingTaskPrefix: "OLD",
          requestedTaskPrefix: "BY",
        },
        help: [
          "Keep using OLD, or manually migrate .but-why/config.json before running init again.",
        ],
      });
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
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_repo_config",
          diagnostics: [
            {
              path: [],
              expected: "valid JSON",
              actual: "{",
              message: expect.stringContaining("Invalid JSON:"),
            },
          ],
        },
      });
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
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_repo_config",
          diagnostics: [{ path: ["extra"], actual: true, message: "Unknown key." }],
        },
      });
    }),
  );

  ordinaryIt("maps runtime errors without leaking stack traces", () => {
    const result = mapRuntimeError();

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
      error: { code: "internal_error", message: "The command failed unexpectedly" },
      help: ["Report this failure with the command and workspace path"],
    });
  });

  ordinaryIt("collapses the home directory in executable paths", () => {
    expect(collapseHome(join(homedir(), ".local/bin/by"))).toBe("~/.local/bin/by");
  });
});
