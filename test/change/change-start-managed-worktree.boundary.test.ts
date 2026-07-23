import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { provisionChangeWorktree } from "../../src/change/changeStartGit.js";
import type { ChangeStartRecord } from "../../src/change/changeStartStore.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";
let initializedRepositoryTemplate: string;

beforeAll(() => {
  initializedRepositoryTemplate = acquireTestWorkspace();
  initializedRepository(initializedRepositoryTemplate);
});

afterAll(() => {
  releaseTestWorkspace(initializedRepositoryTemplate);
});

const repositoryCopy = () => cloneInitializedTestRepository(initializedRepositoryTemplate);

describe("Change Start Managed Worktree boundaries", () => {
  it.effect("creates a ready taskless Change from the local default branch", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

      const result = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as ChangeOutput;
      const startingCommit = git(root, "rev-parse", "refs/heads/main^{commit}");
      expect(output).toMatchObject({
        change: { id: expect.any(String), taskId: null, readiness: "ready" },
        branch: expect.stringMatching(/^refs\/heads\/but-why\/change-/u),
        baseRef: "refs/heads/main",
        startingCommit,
        worktreePath: expect.any(String),
      });
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
      expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
    }),
  );

  it.effect("creates and recovers one Task-backed Change with immutable intent", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const taskId = yield* createTask(root, "Prepared change", "Prepare this Change.\n");
      expect(
        (yield* runByInProcessEffect(root, ["task", "approve", taskId, "--output", "json"], now))
          .status,
      ).toBe(0);

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", taskId, "--output", "json"],
        now,
      );
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      expect(output.change).toMatchObject({ taskId, readiness: "ready" });
      expect((yield* runByInProcessEffect(root, ["task", "show", taskId])).stdout).toContain(
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
      const locked = yield* runByInProcessEffect(
        root,
        ["task", "dependencies", "set", taskId, "--output", "json"],
        now,
      );
      expect(JSON.parse(locked.stdout)).toMatchObject({
        error: { code: "dependencies_locked", taskId, state: "implementing" },
        help: ["Dependency edits are available only before Change Start."],
      });

      git(root, "worktree", "remove", output.worktreePath);
      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", taskId, "--output", "json"],
        now,
      );
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: output.change,
        branch: output.branch,
        startingCommit: output.startingCommit,
        worktreePath: output.worktreePath,
      });
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
    }),
  );

  it.effect("preserves failed preparation and retries it in the same worktree", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          {
            taskPrefix: "BY",
            prepare: {
              command:
                "if [ -f .prepare-attempted ]; then exit 0; else touch .prepare-attempted; printf failed >&2; exit 7; fi",
            },
          },
          null,
          2,
        )}\n`,
      );
      git(root, "add", ".but-why/config.json");
      git(root, "commit", "-m", "Configure preparation");
      git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");

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
      expect(JSON.parse(retried.stdout)).toMatchObject({
        change: { id: failure.error.changeId, readiness: "ready" },
        worktreePath: failure.error.worktreePath,
      });
    }),
  );

  it.effect("rejects Change Start while a Task dependency is unsatisfied", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const prerequisite = yield* createTask(root, "Prerequisite", "First");
      const dependent = yield* createTask(root, "Dependent", "Second");
      expect(
        (yield* runByInProcessEffect(
          root,
          [
            "task",
            "dependencies",
            "set",
            dependent,
            "--depends-on",
            prerequisite,
            "--output",
            "json",
          ],
          now,
        )).status,
      ).toBe(0);
      expect((yield* runByInProcessEffect(root, ["task", "approve", dependent], now)).status).toBe(
        0,
      );

      const blocked = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", dependent, "--output", "json"],
        now,
      );
      expect(JSON.parse(blocked.stdout)).toMatchObject({
        error: {
          code: "task_dependencies_unsatisfied",
          blockedBy: [{ id: prerequisite, state: "new" }],
        },
      });
    }),
  );

  it.effect("keeps Change Start on the Change command", () =>
    Effect.gen(function* () {
      const retired = yield* runByInProcessEffect(createTestWorkspace(), [
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

  it.effect("preserves unexpected branches and occupied Managed Worktree paths", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const start = changeStartRecord(root);
      git(root, "branch", start.branchRef.slice("refs/heads/".length), start.startingCommit);

      expect(provisionChangeWorktree(root, start, false)).toEqual({
        ok: false,
        code: "change_start_conflict",
      });

      git(root, "branch", "-D", start.branchRef.slice("refs/heads/".length));
      mkdirSync(start.worktreePath, { recursive: true });
      writeFileSync(join(start.worktreePath, "keep.txt"), "do not overwrite\n");
      expect(provisionChangeWorktree(root, start, false)).toEqual({
        ok: false,
        code: "change_start_conflict",
      });
      expect(existsSync(join(start.worktreePath, "keep.txt"))).toBe(true);

      rmSync(start.worktreePath, { recursive: true });
      expect(provisionChangeWorktree(root, start, false)).toEqual({ ok: true });
      expect(git(start.worktreePath, "symbolic-ref", "HEAD")).toBe(start.branchRef);
    }),
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

const initializedRepository = (workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const changeStartRecord = (root: string): ChangeStartRecord => {
  const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return {
    id: "change-1",
    repositoryCommonDirectory: commonDirectory,
    branchRef: "refs/heads/but-why/change-1",
    baseRef: "refs/heads/main",
    taskId: null,
    startingCommit: git(root, "rev-parse", "refs/heads/main"),
    worktreePath: join(commonDirectory, "but-why", "worktrees", "change-1"),
    acceptanceContext: null,
    readiness: "pending",
    prepare: null,
    prepareFailure: null,
    publication: null,
    cleanup: { state: "pending", blockingReason: null },
    state: "open",
    closeReason: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
};

const createTask = (root: string, title: string, description: string) =>
  Effect.gen(function* () {
    const descriptionPath = join(root, `.task-${title.toLowerCase()}.md`);
    writeFileSync(descriptionPath, description);
    const created = yield* runByInProcessEffect(
      root,
      [
        "task",
        "create",
        "--title",
        title,
        "--description-file",
        descriptionPath,
        "--output",
        "json",
      ],
      now,
    );
    expect(created.status).toBe(0);
    return (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task.id;
  });

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
