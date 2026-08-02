import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";

import { mapRuntimeError } from "../../src/cli.js";
import { collapseHome } from "../../src/cli/cliPath.js";
import { butWhyGitignoreBlock } from "../../src/init/gitignore.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { encodeToon } from "../../src/output/toon.js";
import { createGitRepo, repoRoot, runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcess } from "../support/testProcess.js";

const expectedBin = collapseHome(join(repoRoot, "bin/by"));
const expectedConfigDoc = join(repoRoot, "docs/public/config.md");
const expectedSetupDoc = join(repoRoot, "docs/public/setup.md");
const managedGitignoreBlock = `${butWhyGitignoreBlock}\n`;
const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");
const expectedCommandPaths = [
  "init",
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
  "task comment",
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
      expect(result.stdout).toContain('help: "DESCRIPTION');
      expect(result.stdout).toContain(
        "Validate completed code changes against approved human intent.",
      );
      expect(result.stdout).toContain("COMMANDS");
      expect(result.stdout).toContain("--json");
      for (const commandPath of expectedCommandPaths) {
        expect(result.stdout, commandPath).toContain(`- ${commandPath}`);
      }
      expect(result.stdout).not.toContain("task task");
      expect(result.stdout).not.toContain("change change");
      expect(result.stdout).toContain("(-h, --help)");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).toContain("--wizard");
      expect(result.stdout).toContain("--completions");
      expect(result.stdout).toContain("--log-level");
    }),
  );

  it.effect("uses native help behavior for trailing arguments", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--json", "task", "--help", "extra"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("Manage repo-local Tasks.");
    }),
  );

  it.effect("uses native leaf help behavior for trailing arguments", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, [
        "--json",
        "task",
        "list",
        "--help",
        "extra",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain("List repo-local Tasks.");
    }),
  );

  it.effect("uses native help behavior for trailing options", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, [
        "--json",
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

  it.effect("prints JSON help when selected after help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help", "--json"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd()).not.toContain("\n");
      const parsed = JSON.parse(result.stdout);

      expect(parsed.help).toContain(
        "Validate completed code changes against approved human intent.",
      );
      expect(parsed.help).toContain("COMMANDS");
      expect(parsed.help).toContain("--json");
      for (const commandPath of expectedCommandPaths) {
        expect(parsed.help, commandPath).toContain(`- ${commandPath}`);
      }
      expect(parsed.help).not.toContain("task task");
      expect(parsed.help).not.toContain("change change");
    }),
  );

  it.effect("prints JSON init help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--json", "init", "--help"]);

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
      const result = yield* runByInProcessEffect(root, ["--json", "init", "--task-prefix", "BY"]);

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

  it.effect("prints JSON help when selected after help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help", "--json"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).help).toContain(
        "Validate completed code changes against approved human intent.",
      );
    }),
  );

  it.effect("uses TOON output when JSON is false", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help", "--json=false"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain('help: "DESCRIPTION');
      expect(() => JSON.parse(result.stdout)).toThrow();
    }),
  );

  it.effect("accepts spaced native JSON boolean values", () =>
    Effect.gen(function* () {
      const json = yield* runByInProcessEffect(repoRoot, ["--json", "true", "--version"]);
      const toon = yield* runByInProcessEffect(repoRoot, ["--json", "false", "--version"]);

      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout)).toEqual({ version: "0.0.1" });
      expect(toon.status).toBe(0);
      expect(toon.stdout).toBe("version: 0.0.1\n");
    }),
  );

  it.effect("rejects invalid native JSON values without version fallback", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--json", "bad", "--version"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "invalid_usage" },
      });
    }),
  );

  it.effect("prints JSON usage errors after a valid JSON selector", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--json", "--bad"]);

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

  it.effect("prints JSON command errors after a valid JSON selector", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["--json", "task", "list"]);

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
      expect(result.stdout).toBe(`error:
  code: invalid_usage
  message: "Received unknown argument: '--bad'"
help[1]: Run \`by --help\` for generated command help.
`);
    }),
  );

  it.effect("rejects the removed output selector", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--output", "json", "--help"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_usage");
      expect(result.stdout).toContain("Invalid subcommand for by");
    }),
  );

  it.effect("rejects the removed short output selector", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "list", "-o", "json"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_usage");
      expect(result.stdout).toContain("Received unknown argument: '-o'");
    }),
  );

  it.effect("prints the init help view", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["init", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain('help: "DESCRIPTION');
      expect(result.stdout).toContain("Create repo-local But Why? state.");
    }),
  );

  it.effect("prints a structured unknown command usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["frobnicate"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_usage");
      expect(result.stdout).toContain("Invalid subcommand for by");
    }),
  );

  it.effect("prints a structured unknown flag usage error", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_usage");
      expect(result.stdout).toContain("Invalid subcommand for by");
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
    review,Keep .but-why/config.json explicit and reviewable.
`);
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
      expect(result.stdout).toContain(`root: ${root}`);
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
              { name: "acceptance_context_versions" },
              { name: "active_validation_runs" },
              { name: "candidate_publications" },
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
              { name: "shared_state_identity" },
              { name: "task_comments" },
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
    review,Keep .but-why/config.json explicit and reviewable.
`);
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
    review,Keep .but-why/config.json explicit and reviewable.
`);
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
    review,Keep .but-why/config.json explicit and reviewable.
`);
    }),
  );

  it.effect("prints not_git_work_tree outside Git", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: not_git_work_tree
  message: by init must be run inside a Git work tree.
help[1]: "Run git init first, or cd into an existing Git repository."
`);
    }),
  );

  it.effect("prints invalid_usage for missing task prefix in non-interactive init", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_usage
  message: "Expected to find option: '--task-prefix'"
help[1]: Run \`by --help\` for generated command help.
`);
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
help[1]: "Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY."
`);
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
help[1]: "Keep using OLD, or manually migrate .but-why/config.json before running init again."
`);
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
