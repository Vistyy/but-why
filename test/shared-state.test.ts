import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, describe } from "vitest";

import {
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  runByInProcessEffect,
} from "./support/by-cli.js";

const now = "2026-06-30T12:00:00.000Z";

afterEach(cleanupTempRoots);

describe("shared repository state", () => {
  it.effect("shares Tasks through Git common state across linked worktrees", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      git(root, "config", "user.email", "test@example.com");
      git(root, "config", "user.name", "Test User");
      git(root, "add", ".but-why/config.json");
      git(root, "commit", "-m", "configure but why");
      const linked = join(createTempRoot(), "linked");
      git(root, "worktree", "add", "-b", "linked", linked);
      writeFileSync(join(root, "task.md"), "Shared Task");

      expect(
        (yield* runByInProcessEffect(
          root,
          ["task", "create", "--title", "Shared", "--description-file", "task.md"],
          now,
        )).status,
      ).toBe(0);

      const result = yield* runByInProcessEffect(linked, ["task", "list"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("id: BY-1");
      expect(result.stdout).toContain("title: Shared");
      expect(result.stdout).toContain("state: new");
      expect(existsSync(sharedStatePath(root))).toBe(true);
      expect(existsSync(join(root, ".but-why", "state.sqlite"))).toBe(false);
      expect(existsSync(join(linked, ".but-why", "state.sqlite"))).toBe(false);
    }),
  );

  it.effect(
    "shares untracked Task Context drafts through Git common state across linked worktrees",
    () =>
      Effect.gen(function* () {
        const root = yield* initializedRepo();
        git(root, "config", "user.email", "test@example.com");
        git(root, "config", "user.name", "Test User");
        git(root, "add", ".but-why/config.json");
        git(root, "commit", "-m", "configure but why");
        const linked = join(createTempRoot(), "linked");
        git(root, "worktree", "add", "-b", "linked", linked);
        writeFileSync(join(root, "task.md"), "Shared Task");
        expect(
          (yield* runByInProcessEffect(
            root,
            ["task", "create", "--title", "Shared", "--description-file", "task.md"],
            now,
          )).status,
        ).toBe(0);

        const rootStatusBeforeDraft = git(root, "status", "--short");
        const linkedStatusBeforeDraft = git(linked, "status", "--short");

        const draftResult = yield* runByInProcessEffect(root, [
          "task",
          "context",
          "draft",
          "BY-1",
          "--output",
          "json",
        ]);
        const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
        writeFileSync(draft.draft.path, "# Shared updated\n\nUpdated from another worktree");

        const applyResult = yield* runByInProcessEffect(
          linked,
          ["task", "context", "apply", "BY-1"],
          now,
        );
        const contextResult = yield* runByInProcessEffect(linked, ["task", "context", "BY-1"]);

        expect(applyResult.status).toBe(0);
        expect(contextResult.stdout).toContain(
          "title: Shared updated\n  description: Updated from another worktree",
        );
        expect(existsSync(draft.draft.path)).toBe(false);
        expect(git(root, "status", "--short")).toBe(rootStatusBeforeDraft);
        expect(git(linked, "status", "--short")).toBe(linkedStatusBeforeDraft);
      }),
  );

  it.effect("rejects shared state that belongs to another Git common directory", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      const database = new DatabaseSync(sharedStatePath(root));
      database
        .prepare("UPDATE shared_state_identity SET common_directory = ? WHERE id = 1")
        .run("/other/.git");
      database.close();

      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe(`error:
  code: shared_state_identity_conflict
  message: Shared But Why? state belongs to a different Git repository.
help[1]: "Restore the repository's own shared state, then run \`by init --task-prefix <prefix>\`."`);
    }),
  );
});

const initializedRepo = (): Effect.Effect<string> =>
  Effect.gen(function* () {
    const root = createGitRepo();
    expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
    return root;
  });

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
