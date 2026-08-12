import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";

import { collapseHome } from "../../src/cli/cliPath.js";
import { mapRuntimeError } from "../../src/cli.js";
import { createGitRepo, repoRoot, runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const expectedConfigDoc = join(repoRoot, "docs/public/config.md");
const expectedSetupDoc = join(repoRoot, "docs/public/setup.md");
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
  "task submit",
  "task reviews",
  "task review show",
  "task review abandon",
  "task-review show",
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
  "validation-run abandon",
] as const;

const parseOutput = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout) as Record<string, unknown>;

describe("by CLI", () => {
  it.effect("routes every generated public command", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const help = parseOutput(result.stdout)["help"];
      expect(help).toEqual(expect.any(String));
      if (typeof help !== "string") return;
      for (const commandPath of expectedCommandPaths) {
        expect(help, commandPath).toContain(`- ${commandPath}`);
      }
      expect(help).not.toContain("task task");
      expect(help).not.toContain("change change");
      for (const nativeCapability of [
        "(-h, --help)",
        "--version",
        "--wizard",
        "--completions",
        "--log-level",
      ]) {
        expect(help, nativeCapability).toContain(nativeCapability);
      }
    }),
  );

  it.effect("describes explicit Task Review reruns in generated help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["task", "submit", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(parseOutput(result.stdout).help).toEqual(
        expect.stringContaining(
          "--rerun\n\n  A true or false value.\n\n  Run another Review of the unchanged unlinked New Task proposal instead of reusing a completed judgment.",
        ),
      );
    }),
  );

  it.effect("classifies Change Submit as a long-running command in generated help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["change", "submit", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(parseOutput(result.stdout)["help"]).toEqual(
        expect.stringContaining("This is a long-running command."),
      );
    }),
  );

  it.effect.each([
    ["parent command", ["task", "--help", "extra"]],
    ["leaf command", ["task", "list", "--help", "extra"]],
    ["options after help", ["task", "list", "--help", "--state", "bad"]],
  ] as const)("uses native help behavior for a %s", (testCase) =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, testCase[1]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(parseOutput(result.stdout)["help"]).toEqual(expect.any(String));
    }),
  );

  it.effect("frames generated help as one compact JSON document", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--help"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd()).not.toContain("\n");
      expect(parseOutput(result.stdout)).toHaveProperty("help");
    }),
  );

  it.effect("prints the package version as one compact JSON document", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--version"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe('{"version":"0.0.1"}\n');
    }),
  );

  it.effect("normalizes parser failures to structured invalid usage", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(repoRoot, ["--bad"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(parseOutput(result.stdout)).toMatchObject({
        error: { code: "invalid_usage" },
        help: ["Run `by --help` for generated command help."],
      });
    }),
  );

  it.effect("initializes the Git work tree root and renders setup decisions", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(parseOutput(result.stdout)).toEqual({
        init: { status: "initialized", root, taskPrefix: "BY" },
        created: [
          ".but-why/config.json",
          "<git-common-dir>/but-why/state.sqlite",
          ".but-why/reviewers/",
        ],
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
      expect(existsSync(join(root, ".gitignore"))).toBe(false);
    }),
  );

  it.effect("initializes the repository root when invoked from a subdirectory", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const subdirectory = join(root, "packages/app");
      mkdirSync(subdirectory, { recursive: true });

      const result = yield* runByInProcessEffect(subdirectory, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(parseOutput(result.stdout)).toMatchObject({ init: { root } });
      expect(existsSync(join(root, ".but-why/config.json"))).toBe(true);
      expect(existsSync(join(subdirectory, ".but-why/config.json"))).toBe(false);
    }),
  );

  it.effect("renders repaired initialization artifacts", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      rmSync(sharedStatePath(root));
      rmSync(join(root, ".but-why/reviewers"), { recursive: true });

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(parseOutput(result.stdout)).toMatchObject({
        init: { status: "repaired", root, taskPrefix: "BY" },
        created: ["<git-common-dir>/but-why/state.sqlite", ".but-why/reviewers/"],
      });
    }),
  );

  it.effect("maps representative initialization failures", () =>
    Effect.gen(function* () {
      const outsideGit = yield* runByInProcessEffect(createTestWorkspace(), [
        "init",
        "--task-prefix",
        "BY",
      ]);
      expect(outsideGit.status).toBe(1);
      expect(parseOutput(outsideGit.stdout)).toMatchObject({
        error: { code: "not_git_work_tree" },
      });

      const invalidPrefix = yield* runByInProcessEffect(createGitRepo(), [
        "init",
        "--task-prefix",
        "by",
      ]);
      expect(invalidPrefix.status).toBe(2);
      expect(parseOutput(invalidPrefix.stdout)).toMatchObject({
        error: { code: "invalid_task_prefix", taskPrefix: "by" },
      });

      const conflictRoot = createGitRepo();
      expect(
        (yield* runByInProcessEffect(conflictRoot, ["init", "--task-prefix", "OLD"])).status,
      ).toBe(0);
      const conflict = yield* runByInProcessEffect(conflictRoot, ["init", "--task-prefix", "BY"]);
      expect(conflict.status).toBe(1);
      expect(parseOutput(conflict.stdout)).toMatchObject({
        error: {
          code: "task_prefix_conflict",
          existingTaskPrefix: "OLD",
          requestedTaskPrefix: "BY",
        },
      });

      const malformedRoot = createGitRepo();
      mkdirSync(join(malformedRoot, ".but-why"));
      writeFileSync(join(malformedRoot, ".but-why/config.json"), "{");
      const malformed = yield* runByInProcessEffect(malformedRoot, ["init", "--task-prefix", "BY"]);
      expect(malformed.status).toBe(1);
      expect(parseOutput(malformed.stdout)).toMatchObject({
        error: { code: "invalid_repo_config", diagnostics: [{ path: [], expected: "valid JSON" }] },
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
