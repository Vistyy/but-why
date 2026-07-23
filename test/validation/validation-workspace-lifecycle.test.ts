import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { afterEach, describe, vi } from "vitest";

import type { createValidationWorkspace as createValidationWorkspaceType } from "../../src/validation/createValidationWorkspace.js";

const input = {
  repoRoot: "/repo",
  validationRunId: "by-1-test.1",
  submittedSha: "abc123",
  copyFiles: [],
  sandboxMode: "none" as const,
};

const tempRefName = "refs/but-why/validation-runs/by-1-test.1/validation";
const expectedWorktreePath =
  "/repo/.sandcastle/worktrees/refs-but-why-validation-runs-by-1-test.1-validation";

afterEach(() => {
  vi.doUnmock("@ai-hero/sandcastle");
  vi.resetModules();
});

describe("Validation Workspace scoped lifecycle", () => {
  it.scoped("cleans up a successful workspace in reverse acquisition order", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: true,
        setup: {
          validationRunId: input.validationRunId,
          submittedSha: input.submittedSha,
          worktreeHead: input.submittedSha,
          cleanupResult: {
            worktree: "removed",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "read:worktree_head",
        "close:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("reuses a matching clean Validation Workspace", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: tempRefName,
            head: input.submittedSha,
            dirty: false,
          },
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: true,
        setup: {
          submittedSha: input.submittedSha,
          worktreeHead: input.submittedSha,
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "read:worktree_head",
        "close:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("removes and recreates a matching dirty Validation Workspace", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: tempRefName,
            head: input.submittedSha,
            dirty: true,
          },
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: true,
        setup: {
          submittedSha: input.submittedSha,
          worktreeHead: input.submittedSha,
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "remove:worktree",
        "acquire:worktree",
        "read:worktree_head",
        "close:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("rejects an existing Validation Workspace on another branch", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: "refs/heads/other-run",
            head: input.submittedSha,
            dirty: false,
          },
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_sandcastle_workspace",
          errorMessage:
            "Validation worktree already exists for a different Validation Run: " +
            expectedWorktreePath,
          cleanupResult: {
            worktree: "not_created",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual(["acquire:temp_ref", "release:temp_ref"]);
    }),
  );

  it.scoped("rejects an existing Validation Workspace at another commit", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: tempRefName,
            head: "different-commit",
            dirty: false,
          },
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_sandcastle_workspace",
          errorMessage: `Validation worktree already exists for a different commit: ${expectedWorktreePath}`,
          cleanupResult: {
            worktree: "not_created",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual(["acquire:temp_ref", "release:temp_ref"]);
    }),
  );

  it.scoped("fails when removing a dirty Validation Workspace leaves it present", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: tempRefName,
            head: input.submittedSha,
            dirty: true,
          },
          worktreeCleanup: "failed",
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_sandcastle_workspace",
          errorMessage: `Validation worktree already exists with uncommitted changes: ${expectedWorktreePath}`,
          worktreePath: expectedWorktreePath,
          cleanupResult: {
            worktree: "not_created",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual(["acquire:temp_ref", "remove:worktree", "release:temp_ref"]);
    }),
  );

  it.scoped("recovers when failed removal proves the Validation Workspace disappeared", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          existingWorktree: {
            branch: tempRefName,
            head: input.submittedSha,
            dirty: true,
          },
          worktreeCleanup: "failed",
          worktreeDisappearsAfterFailedRemoval: true,
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: true,
        setup: {
          submittedSha: input.submittedSha,
          worktreeHead: input.submittedSha,
          cleanupResult: {
            worktree: "removed",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "remove:worktree",
        "acquire:worktree",
        "read:worktree_head",
        "close:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("does not clean up when temp ref acquisition fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          tempRefFailure: "bad ref",
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_temp_ref",
          errorMessage: "bad ref",
          cleanupResult: {
            worktree: "not_created",
            tempRef: "not_created",
          },
        },
      });
      expect(events).toEqual(["acquire:temp_ref"]);
    }),
  );

  it.scoped("cleans up the temp ref and partial worktree when worktree creation fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          worktreeCreationFailure: "sandcastle failed",
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_sandcastle_workspace",
          errorMessage: "sandcastle failed",
          cleanupResult: {
            worktree: "removed",
            tempRef: "removed",
          },
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("keeps setup failure primary when cleanup also fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          worktreeCreationFailure: "sandcastle failed",
          worktreeCleanup: "failed",
          tempRefCleanup: "failed",
        }),
      );

      const result = yield* createValidationWorkspace(input);

      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "create_sandcastle_workspace",
          errorMessage: "sandcastle failed",
          cleanupResult: {
            worktree: "failed",
            tempRef: "failed",
          },
        },
      });
      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );

  it.scoped("runs acquired-resource cleanup when interrupted", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const recordedCleanupResults: unknown[] = [];
      let resolveWorktreeAcquired: () => void = () => {};
      const worktreeAcquired = new Promise<void>((resolve) => {
        resolveWorktreeAcquired = resolve;
      });
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          neverFinishWorktreeCreation: true,
          onWorktreeAcquired: resolveWorktreeAcquired,
        }),
      );

      const program = Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          createValidationWorkspace({
            ...input,
            recordInterruptedCleanupResult: (toolingError) =>
              Effect.sync(() => {
                recordedCleanupResults.push(toolingError.cleanupResult);
              }),
          }),
        );
        yield* Effect.promise(() => worktreeAcquired);
        yield* Fiber.interrupt(fiber);
      });

      yield* program;

      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
      expect(recordedCleanupResults).toEqual([{ worktree: "removed", tempRef: "removed" }]);
    }),
  );

  it.scoped("runs acquired-resource cleanup when the workflow defects", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, {
          worktreeHeadFailure: true,
        }),
      );

      const exit = yield* Effect.exit(createValidationWorkspace(input));
      expect(Exit.isFailure(exit)).toBe(true);

      expect(events).toEqual([
        "acquire:temp_ref",
        "acquire:worktree",
        "read:worktree_head",
        "close:worktree",
        "remove:worktree",
        "release:temp_ref",
      ]);
    }),
  );
});

type FakeOptions = {
  readonly existingWorktree?: {
    readonly branch: string | undefined;
    readonly head: string | undefined;
    readonly dirty: boolean;
  };
  readonly tempRefFailure?: string;
  readonly worktreeCreationFailure?: string;
  readonly neverFinishWorktreeCreation?: boolean;
  readonly onWorktreeAcquired?: () => void;
  readonly worktreeHeadFailure?: boolean;
  readonly worktreeCleanup?: "removed" | "failed";
  readonly worktreeDisappearsAfterFailedRemoval?: boolean;
  readonly tempRefCleanup?: "removed" | "failed";
};

const loadCreateValidationWorkspace = async (
  events: string[],
  options: FakeOptions = {},
): Promise<typeof createValidationWorkspaceType> => {
  vi.resetModules();
  let existingWorktree = options.existingWorktree;
  let worktreeExists = false;
  let removalCount = 0;

  vi.doMock("@ai-hero/sandcastle", () => ({
    createSandbox: async () => {
      events.push("acquire:worktree");
      worktreeExists = true;
      options.onWorktreeAcquired?.();

      if (options.neverFinishWorktreeCreation) {
        await new Promise(() => {});
      }

      if (options.worktreeCreationFailure !== undefined) {
        throw new Error(options.worktreeCreationFailure);
      }

      return {
        worktreePath: expectedWorktreePath,
        close: async () => {
          events.push("close:worktree");
          return { preservedWorktreePath: expectedWorktreePath };
        },
        exec: async () => {
          events.push("read:worktree_head");

          if (options.worktreeHeadFailure) {
            throw new Error("boom");
          }

          return { exitCode: 0, stdout: `${input.submittedSha}\n`, stderr: "" };
        },
      };
    },
  }));

  vi.doMock("@ai-hero/sandcastle/sandboxes/no-sandbox", () => ({
    noSandbox: () => ({}),
  }));

  vi.doMock("../../src/validation/validationGitGlue.js", () => ({
    validationTempRefName: () => tempRefName,
    expectedSandcastleWorktreePath: () => expectedWorktreePath,
    ensureValidationTempRef: () => {
      events.push("acquire:temp_ref");

      return options.tempRefFailure === undefined
        ? { ok: true }
        : { ok: false, message: options.tempRefFailure };
    },
    deleteValidationTempRef: () => {
      events.push("release:temp_ref");
      return options.tempRefCleanup ?? "removed";
    },
    inspectExistingWorktree: () =>
      existingWorktree === undefined
        ? worktreeExists
          ? { exists: true, branch: undefined, head: input.submittedSha, dirty: false }
          : { exists: false }
        : { exists: true, ...existingWorktree },
    removeValidationWorktree: () => {
      events.push("remove:worktree");
      removalCount += 1;
      const removed =
        options.worktreeCleanup !== "failed" ||
        (options.worktreeDisappearsAfterFailedRemoval && removalCount > 1);

      if (removed || options.worktreeDisappearsAfterFailedRemoval) {
        existingWorktree = undefined;
        worktreeExists = false;
      }

      return removed;
    },
  }));

  const module = await import("../../src/validation/createValidationWorkspace.js");

  return module.createValidationWorkspace;
};
