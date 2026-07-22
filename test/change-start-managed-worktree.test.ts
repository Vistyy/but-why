import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";

import { openSqliteChangeStartPersistence } from "../src/sqlite/sqliteChangeStartPersistence.js";
import { publicTaskId, taskSlugForId } from "../src/task/taskId.js";
import { runByInProcessEffect, runByWithEnv } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { withTestRepository } from "./support/repository.js";

const now = "2026-06-30T12:00:00.000Z";

describe("by change start managed worktree", () => {
  it.effect("creates a ready taskless Change from the local default branch", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

      const result = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as ChangeOutput;
      const startingCommit = git(root, "rev-parse", "refs/heads/main^{commit}");

      expect(output).toMatchObject({
        change: { id: expect.any(String), taskId: null, readiness: "ready" },
        branch: expect.stringMatching(/^refs\/heads\/but-why\/change-/u),
        baseRef: "refs/heads/main",
        startingCommit,
        worktreePath: expect.any(String),
      });
      expect(existsSync(output.worktreePath)).toBe(true);
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
      expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
    }),
  );

  it.effect("creates a Task-backed Change with immutable Acceptance Context", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      createApprovedTask(root);

      const result = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", "BY-1", "--output", "json"],
        now,
      );

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as ChangeOutput;
      expect(output.change).toMatchObject({ taskId: "BY-1", readiness: "ready" });
      expect((yield* runByInProcessEffect(root, ["task", "show", "BY-1"])).stdout).toContain(
        "state: implementing",
      );
      const persisted = yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const changes = yield* openSqliteChangeStartPersistence();
          return yield* changes.getById(output.change.id);
        }),
      );
      expect(persisted).toMatchObject({
        acceptanceContext: {
          version: 1,
          title: "Prepared change",
          description: "Prepare this Change.\n",
          comments: [],
        },
      });
    }),
  );

  it.effect("preserves a failed preparation and retries it in the same worktree", () =>
    Effect.gen(function* () {
      const root = initializedRepository(
        "if [ -f .prepare-attempted ]; then exit 0; else touch .prepare-attempted; printf failed >&2; exit 7; fi",
      );

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );

      expect(started.status).toBe(1);
      const failure = JSON.parse(started.stdout);
      expect(failure).toMatchObject({
        error: {
          code: "prepare_failed",
          changeId: expect.any(String),
          readiness: "prepare_failed",
          exitCode: 7,
          timedOut: false,
          stderr: "failed",
          worktreePath: expect.any(String),
        },
      });
      expect(existsSync(failure.error.worktreePath)).toBe(true);

      const retried = yield* runByInProcessEffect(
        root,
        ["change", "prepare", failure.error.changeId, "--output", "json"],
        now,
      );

      expect(retried.status).toBe(0);
      expect(JSON.parse(retried.stdout)).toMatchObject({
        change: {
          id: failure.error.changeId,
          readiness: "ready",
        },
        worktreePath: failure.error.worktreePath,
      });
    }),
  );

  it.effect("recovers a missing Task-backed worktree without creating another Change", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      createApprovedTask(root);
      const first = JSON.parse(
        (yield* runByInProcessEffect(
          root,
          ["change", "start", "--task", "BY-1", "--output", "json"],
          now,
        )).stdout,
      ) as ChangeOutput;
      git(root, "worktree", "remove", first.worktreePath);

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", "BY-1", "--output", "json"],
        now,
      );

      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: first.change,
        branch: first.branch,
        startingCommit: first.startingCommit,
        worktreePath: first.worktreePath,
      });
      expect(git(first.worktreePath, "symbolic-ref", "HEAD")).toBe(first.branch);
    }),
  );

  it.effect("preserves unexpected branches and occupied worktree paths", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      createApprovedTask(root);
      const slug = taskSlugForId(publicTaskId("BY-1"));
      git(root, "branch", `but-why/${slug}`, "refs/heads/main");

      const branchConflict = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", "BY-1", "--output", "json"],
        now,
      );

      expect(branchConflict.status).toBe(1);
      expect(JSON.parse(branchConflict.stdout)).toMatchObject({
        error: { code: "change_start_conflict" },
      });
      expect((yield* runByInProcessEffect(root, ["task", "show", "BY-1"])).stdout).toContain(
        "state: todo",
      );

      git(root, "branch", "-D", `but-why/${slug}`);
      const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
      const worktreePath = join(commonDirectory, "but-why", "worktrees", slug);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, "keep.txt"), "do not overwrite\n");

      const pathConflict = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", "BY-1", "--output", "json"],
        now,
      );
      expect(pathConflict.status).toBe(1);
      expect(JSON.parse(pathConflict.stdout)).toMatchObject({
        error: { code: "change_start_conflict" },
      });
      expect(existsSync(join(worktreePath, "keep.txt"))).toBe(true);

      rmSync(worktreePath, { recursive: true });
      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", "BY-1", "--output", "json"],
        now,
      );
      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({ worktreePath });
    }),
  );

  it.effect("recovers taskless provisioning through Change Prepare", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
      const worktreesDirectory = join(commonDirectory, "but-why", "worktrees");
      writeFileSync(worktreesDirectory, "blocks worktree creation\n");

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );

      expect(started.status).toBe(1);
      const failure = JSON.parse(started.stdout);
      expect(failure).toMatchObject({
        error: {
          code: "git_tooling_error",
          changeId: expect.any(String),
          worktreePath: expect.any(String),
        },
      });

      rmSync(worktreesDirectory);
      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", failure.error.changeId, "--output", "json"],
        now,
      );
      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: { id: failure.error.changeId, readiness: "ready" },
        worktreePath: failure.error.worktreePath,
      });
      expect(existsSync(failure.error.worktreePath)).toBe(true);
    }),
  );

  it.effect(
    "requires an approved dependency-unblocked Task",
    () =>
      Effect.gen(function* () {
        const root = initializedRepository();
        const prerequisite = createTaskProcess(root, "Prerequisite", "First");
        const dependent = createTaskProcess(root, "Dependent", "Second");
        expect(
          runByWithEnv(
            root,
            { BUT_WHY_NOW: now },
            "task",
            "dependencies",
            "set",
            dependent.id,
            "--depends-on",
            prerequisite.id,
          ).status,
        ).toBe(0);
        expect(
          runByWithEnv(root, { BUT_WHY_NOW: now }, "task", "approve", dependent.id).status,
        ).toBe(0);

        const blocked = yield* runByInProcessEffect(
          root,
          ["change", "start", "--task", dependent.id, "--output", "json"],
          now,
        );

        expect(blocked.status).toBe(1);
        expect(JSON.parse(blocked.stdout)).toMatchObject({
          error: {
            code: "task_dependencies_unsatisfied",
            blockedBy: [{ id: prerequisite.id, state: "new" }],
          },
        });
      }),
    15_000,
  );

  it.effect("returns TOON by default", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(initializedRepository(), ["change", "start"], now);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("change:\n  id:");
      expect(result.stdout).toContain("readiness: ready");
      expect(result.stdout).toContain("worktreePath:");
    }),
  );

  it.effect("removes the Task Start route", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      createApprovedTask(root);

      const retired = yield* runByInProcessEffect(root, [
        "task",
        "start",
        "BY-1",
        "--output",
        "json",
      ]);
      expect(retired.status).toBe(2);
      expect(JSON.parse(retired.stdout)).toMatchObject({ error: { code: "unknown_command" } });
    }),
  );

  ordinaryIt(
    "persists Task-backed Change Start across executable CLI processes",
    () => {
      const root = initializedRepository();
      writeFileSync(join(root, "task.md"), "Prepare this Change.\n");

      const created = runByWithEnv(
        root,
        { BUT_WHY_NOW: now },
        "task",
        "create",
        "--title",
        "Prepared change",
        "--description-file",
        "task.md",
        "--output",
        "json",
      );
      expect(created.status).toBe(0);
      expect(runByWithEnv(root, { BUT_WHY_NOW: now }, "task", "approve", "BY-1").status).toBe(0);

      const started = runByWithEnv(
        root,
        { BUT_WHY_NOW: now },
        "change",
        "start",
        "--task",
        "BY-1",
        "--output",
        "json",
      );
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      expect(output.change).toMatchObject({ taskId: "BY-1", readiness: "ready" });

      expect(
        runByWithEnv(root, { BUT_WHY_NOW: now }, "change", "prepare", output.change.id).status,
      ).toBe(0);
      expect(runByWithEnv(root, {}, "task", "show", "BY-1").stdout).toContain(
        "state: implementing",
      );
      expect(runByWithEnv(root, {}, "change", "show", output.change.id).stdout).toContain(
        `id: ${output.change.id}`,
      );
    },
    15_000,
  );
});

type ChangeOutput = {
  readonly change: {
    readonly id: string;
    readonly taskId: string | null;
    readonly readiness: string;
  };
  readonly branch: string;
  readonly baseRef: string;
  readonly startingCommit: string;
  readonly worktreePath: string;
};

const initializedRepository = (prepare?: string): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");

  if (prepare !== undefined) {
    writeFileSync(
      join(root, ".but-why", "config.json"),
      `${JSON.stringify({ taskPrefix: "BY", prepare: { command: prepare } }, null, 2)}\n`,
    );
  }
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const createTaskProcess = (root: string, title: string, description: string) => {
  const descriptionPath = join(root, `.task-${title.toLowerCase().replaceAll(" ", "-")}.md`);
  writeFileSync(descriptionPath, description);
  const created = runByWithEnv(
    root,
    { BUT_WHY_NOW: now },
    "task",
    "create",
    "--title",
    title,
    "--description-file",
    descriptionPath,
    "--output",
    "json",
  );
  if (created.status !== 0) throw new Error(created.stdout || created.stderr);
  return (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task;
};

const createApprovedTask = (root: string): void => {
  const task = createTaskProcess(root, "Prepared change", "Prepare this Change.\n");
  const approved = runByWithEnv(root, { BUT_WHY_NOW: now }, "task", "approve", task.id);
  expect(approved.status).toBe(0);
};

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
