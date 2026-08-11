import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { describe, onTestFinished, it as ordinaryIt } from "vitest";

import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
  testWorkspace,
} from "../support/testWorkspace.js";

ordinaryIt("releases a test workspace after process-backed test execution", () => {
  let workspace = "";
  onTestFinished(() => expect(existsSync(workspace)).toBe(false));

  workspace = createTestWorkspace();
  expect(existsSync(workspace)).toBe(true);
});

it.scoped("releases a test workspace after successful Effect execution", () =>
  Effect.gen(function* () {
    let workspace = "";

    yield* Effect.scoped(
      Effect.gen(function* () {
        workspace = yield* testWorkspace;
        expect(existsSync(workspace)).toBe(true);
      }),
    );

    expect(existsSync(workspace)).toBe(false);
  }),
);

it.scoped("releases a test workspace after failed Effect execution", () =>
  Effect.gen(function* () {
    let workspace = "";

    const exit = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          workspace = yield* testWorkspace;
          return yield* Effect.fail("test failure");
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(existsSync(workspace)).toBe(false);
  }),
);

it.scoped("releases a test workspace after interrupted Effect execution", () =>
  Effect.gen(function* () {
    let workspace = "";
    let resolveWorkspaceAcquired: () => void = () => {};
    const workspaceAcquired = new Promise<void>((resolve) => {
      resolveWorkspaceAcquired = resolve;
    });

    const fiber = yield* Effect.fork(
      Effect.scoped(
        Effect.gen(function* () {
          workspace = yield* testWorkspace;
          yield* Effect.sync(resolveWorkspaceAcquired);
          return yield* Effect.never;
        }),
      ),
    );
    yield* Effect.promise(() => workspaceAcquired);
    yield* Fiber.interrupt(fiber);

    expect(existsSync(workspace)).toBe(false);
  }),
);

describe("disposable workspace sibling ownership", () => {
  it.scoped(
    "removes fixture-owned Managed Worktree, linked-repository, snapshot, and symlink-target siblings",
    () =>
      Effect.gen(function* () {
        let workspace = "";
        let managedWorktree = "";
        let linkedRepository = "";
        let snapshotSibling = "";
        let symlinkTarget = "";
        let symlinkSibling = "";

        yield* Effect.scoped(
          Effect.gen(function* () {
            workspace = yield* testWorkspace;
            const parent = dirname(workspace);
            const base = basename(workspace);
            // Production Managed Worktree derivation: siblingRoot + "/but-why/<slug>"
            managedWorktree = join(parent, `${base}-worktrees`, "but-why", "feature");
            linkedRepository = join(parent, `${base}-linked`);
            snapshotSibling = join(parent, `${base}-snapshot`);
            symlinkTarget = join(parent, `${base}-symlink-target`);
            // Symlink sibling that points to target (both are owned and must be removed)
            symlinkSibling = join(parent, `${base}-worktrees-symlink`);

            mkdirSync(managedWorktree, { recursive: true });
            writeFileSync(join(managedWorktree, "file.txt"), "managed worktree content\n");
            mkdirSync(linkedRepository, { recursive: true });
            writeFileSync(join(linkedRepository, "linked.txt"), "linked repo\n");
            mkdirSync(snapshotSibling, { recursive: true });
            writeFileSync(join(snapshotSibling, "snapshot.txt"), "snapshot\n");
            mkdirSync(symlinkTarget, { recursive: true });
            writeFileSync(join(symlinkTarget, "target.txt"), "target\n");
            symlinkSync(symlinkTarget, symlinkSibling, "dir");

            expect(existsSync(workspace)).toBe(true);
            expect(existsSync(managedWorktree)).toBe(true);
            expect(existsSync(linkedRepository)).toBe(true);
            expect(existsSync(snapshotSibling)).toBe(true);
            expect(existsSync(symlinkTarget)).toBe(true);
            expect(existsSync(symlinkSibling)).toBe(true);
          }),
        );

        expect(existsSync(workspace)).toBe(false);
        expect(existsSync(managedWorktree)).toBe(false);
        expect(existsSync(join(dirname(workspace), `${basename(workspace)}-worktrees`))).toBe(
          false,
        );
        expect(existsSync(linkedRepository)).toBe(false);
        expect(existsSync(snapshotSibling)).toBe(false);
        expect(existsSync(symlinkTarget)).toBe(false);
        expect(existsSync(symlinkSibling)).toBe(false);
      }),
  );

  it.scoped("removes siblings after failed Effect execution", () =>
    Effect.gen(function* () {
      let workspace = "";
      let sibling = "";
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            workspace = yield* testWorkspace;
            sibling = join(
              dirname(workspace),
              `${basename(workspace)}-worktrees`,
              "but-why",
              "failed",
            );
            mkdirSync(sibling, { recursive: true });
            writeFileSync(join(sibling, "keep.txt"), "keep\n");
            return yield* Effect.fail("test failure");
          }),
        ),
      );
      expect(exit._tag).toBe("Failure");
      expect(existsSync(workspace)).toBe(false);
      expect(existsSync(sibling)).toBe(false);
      expect(existsSync(join(dirname(workspace), `${basename(workspace)}-worktrees`))).toBe(false);
    }),
  );

  it.scoped("removes siblings after interrupted Effect execution", () =>
    Effect.gen(function* () {
      let workspace = "";
      let sibling = "";
      let resolveWorkspaceAcquired: () => void = () => {};
      const workspaceAcquired = new Promise<void>((resolve) => {
        resolveWorkspaceAcquired = resolve;
      });
      const fiber = yield* Effect.fork(
        Effect.scoped(
          Effect.gen(function* () {
            workspace = yield* testWorkspace;
            sibling = join(
              dirname(workspace),
              `${basename(workspace)}-worktrees`,
              "but-why",
              "interrupted",
            );
            mkdirSync(sibling, { recursive: true });
            writeFileSync(join(sibling, "keep.txt"), "keep\n");
            yield* Effect.sync(resolveWorkspaceAcquired);
            return yield* Effect.never;
          }),
        ),
      );
      yield* Effect.promise(() => workspaceAcquired);
      yield* Fiber.interrupt(fiber);
      expect(existsSync(workspace)).toBe(false);
      expect(existsSync(sibling)).toBe(false);
    }),
  );

  it.scoped("removes siblings created through real Managed Worktree path derivation", () =>
    Effect.gen(function* () {
      let workspace = "";
      let managedWorktreePath = "";
      yield* Effect.scoped(
        Effect.gen(function* () {
          workspace = yield* testWorkspace;
          // Derive exactly as src/change/adapters/changeStartGit.ts does
          const slug = `change-${workspace.slice(-6)}`;
          managedWorktreePath = join(
            dirname(workspace),
            `${basename(workspace)}-worktrees`,
            "but-why",
            slug,
          );
          mkdirSync(managedWorktreePath, { recursive: true });
          writeFileSync(
            join(managedWorktreePath, ".git"),
            `gitdir: ${workspace}/.git/worktrees/${slug}\n`,
          );
        }),
      );
      expect(existsSync(workspace)).toBe(false);
      expect(existsSync(managedWorktreePath)).toBe(false);
    }),
  );
});

describe("workspace sibling isolation", () => {
  ordinaryIt("does not remove another fixture's siblings", () => {
    const workspaceA = acquireTestWorkspace();
    const workspaceB = acquireTestWorkspace();
    const siblingA = join(
      dirname(workspaceA),
      `${basename(workspaceA)}-worktrees`,
      "but-why",
      "feature-a",
    );
    const siblingB = join(
      dirname(workspaceB),
      `${basename(workspaceB)}-worktrees`,
      "but-why",
      "feature-b",
    );
    const symlinkTargetA = join(dirname(workspaceA), `${basename(workspaceA)}-symlink-target`);
    const symlinkTargetB = join(dirname(workspaceB), `${basename(workspaceB)}-symlink-target`);

    mkdirSync(siblingA, { recursive: true });
    writeFileSync(join(siblingA, "keep.txt"), "a\n");
    mkdirSync(siblingB, { recursive: true });
    writeFileSync(join(siblingB, "keep.txt"), "b\n");
    mkdirSync(symlinkTargetA, { recursive: true });
    mkdirSync(symlinkTargetB, { recursive: true });

    onTestFinished(() => {
      // Ensure second fixture is eventually cleaned even if first assertion fails
      if (existsSync(workspaceB) || existsSync(siblingB) || existsSync(symlinkTargetB)) {
        releaseTestWorkspace(workspaceB);
      }
      expect(existsSync(workspaceB)).toBe(false);
      expect(existsSync(siblingB)).toBe(false);
      expect(existsSync(symlinkTargetB)).toBe(false);
    });

    releaseTestWorkspace(workspaceA);

    expect(existsSync(workspaceA)).toBe(false);
    expect(existsSync(siblingA)).toBe(false);
    expect(existsSync(symlinkTargetA)).toBe(false);
    expect(existsSync(workspaceB)).toBe(true);
    expect(existsSync(siblingB)).toBe(true);
    expect(existsSync(symlinkTargetB)).toBe(true);

    // Cleanup second for the onTestFinished assertion (idempotent)
    releaseTestWorkspace(workspaceB);
  });

  ordinaryIt("does not delete unrelated tmp entries that do not belong to the fixture", () => {
    const workspace = acquireTestWorkspace();
    const parent = dirname(workspace);
    const unrelated = join(parent, `but-why-unrelated-${Date.now()}`);
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, "keep.txt"), "unrelated\n");

    const ownedSibling = join(parent, `${basename(workspace)}-worktrees`, "but-why", "owned");
    mkdirSync(ownedSibling, { recursive: true });

    onTestFinished(() => {
      if (existsSync(unrelated)) {
        try {
          rmSync(unrelated, { recursive: true, force: true });
        } catch {}
      }
      expect(existsSync(unrelated)).toBe(false);
    });

    releaseTestWorkspace(workspace);

    expect(existsSync(workspace)).toBe(false);
    expect(existsSync(ownedSibling)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);

    rmSync(unrelated, { recursive: true, force: true });
  });
});
