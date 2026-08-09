import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { afterEach, describe, vi } from "vitest";

import type { createValidationWorkspace as createValidationWorkspaceType } from "../../src/change/validation/createValidationWorkspace.js";

const input = {
  repoRoot: "/repo",
  validationRunId: "by-1-test.1",
  submittedSha: "abc123",
  copyFiles: [],
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

  it.scoped(
    "accepts a clean workspace removed after the old cleanup limit",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const createValidationWorkspace = yield* Effect.promise(() =>
          loadCreateValidationWorkspace(events, { closeDelayMs: 5_100 }),
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
          "acquire:worktree",
          "read:worktree_head",
          "close:worktree",
          "release:temp_ref",
        ]);
      }),
    15_000,
  );

  it.scoped(
    "fails without retrying removal when close remains in flight at the cleanup limit",
    () =>
      Effect.gen(function* () {
        vi.useFakeTimers();
        try {
          const events: string[] = [];
          let resolveCloseStarted: () => void = () => {};
          const closeStarted = new Promise<void>((resolve) => {
            resolveCloseStarted = resolve;
          });
          const createValidationWorkspace = yield* Effect.promise(() =>
            loadCreateValidationWorkspace(events, {
              neverFinishClose: true,
              onCloseStarted: resolveCloseStarted,
            }),
          );
          const fiber = yield* Effect.fork(createValidationWorkspace(input));
          yield* Effect.promise(() => closeStarted);
          vi.advanceTimersByTime(30_000);
          const result = yield* Fiber.join(fiber);

          expect(result).toMatchObject({
            ok: false,
            toolingError: {
              operationName: "cleanup_validation_workspace",
              cleanupResult: {
                worktree: "failed",
                tempRef: "removed",
              },
            },
          });
          expect(events).toEqual([
            "acquire:temp_ref",
            "acquire:worktree",
            "read:worktree_head",
            "close:worktree",
            "release:temp_ref",
          ]);
        } finally {
          vi.useRealTimers();
        }
      }),
    45_000,
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
      const recordedSetups: unknown[] = [];
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
            recordWorkspaceSetup: (setup) =>
              Effect.sync(() => {
                recordedSetups.push(setup);
              }),
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
      expect(recordedSetups).toMatchObject([
        {
          validationRunId: input.validationRunId,
          tempRefName,
          submittedSha: input.submittedSha,
          worktreeHead: input.submittedSha,
          worktreePath: expectedWorktreePath,
          cleanupResult: { worktree: "not_created", tempRef: "not_created" },
        },
      ]);
    }),
  );

  it.scoped(
    "rejects a freshly created Validation Workspace whose HEAD differs from the Candidate head",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const createValidationWorkspace = yield* Effect.promise(() =>
          loadCreateValidationWorkspace(events, { worktreeHead: "different-commit" }),
        );

        const result = yield* createValidationWorkspace(input);

        expect(result).toMatchObject({
          ok: false,
          toolingError: {
            operationName: "create_sandcastle_workspace",
            errorMessage: `Validation worktree HEAD different-commit did not match submitted SHA ${input.submittedSha}.`,
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

  it.scoped("does not report a passed run when cleanup fails after successful workspace use", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      let phasesRan = false;
      const createValidationWorkspace = yield* Effect.promise(() =>
        loadCreateValidationWorkspace(events, { worktreeCleanup: "failed" }),
      );

      const result = yield* createValidationWorkspace({
        ...input,
        runInWorkspace: (workspace) =>
          Effect.sync(() => {
            phasesRan = true;
            expect(workspace.worktreePath).toBe(expectedWorktreePath);
            return { validationFindings: 0 as const };
          }),
      });

      expect(phasesRan).toBe(true);
      expect(result).toMatchObject({
        ok: false,
        toolingError: {
          operationName: "cleanup_validation_workspace",
          errorMessage: "Validation workspace cleanup failed after successful setup.",
          cleanupResult: {
            worktree: "failed",
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
  readonly neverFinishClose?: boolean;
  readonly onCloseStarted?: () => void;
  readonly closeDelayMs?: number;
  readonly onWorktreeAcquired?: () => void;
  readonly worktreeHead?: string;
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
          options.onCloseStarted?.();
          if (options.neverFinishClose) {
            await new Promise(() => {});
          }
          if (options.closeDelayMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, options.closeDelayMs));
            worktreeExists = false;
            return { preservedWorktreePath: undefined };
          }
          return { preservedWorktreePath: expectedWorktreePath };
        },
        exec: async () => {
          events.push("read:worktree_head");

          if (options.worktreeHeadFailure) {
            throw new Error("boom");
          }

          return {
            exitCode: 0,
            stdout: `${options.worktreeHead ?? input.submittedSha}\n`,
            stderr: "",
          };
        },
      };
    },
  }));

  vi.doMock("@ai-hero/sandcastle/sandboxes/no-sandbox", () => ({
    noSandbox: () => ({}),
  }));

  vi.doMock("../../src/workspace/workspaceGit.js", () => ({
    disposableWorktreePath: () => expectedWorktreePath,
    ensureDisposableTempRef: () => {
      events.push("acquire:temp_ref");

      return options.tempRefFailure === undefined
        ? { ok: true }
        : { ok: false, message: options.tempRefFailure };
    },
    deleteDisposableTempRef: () => {
      events.push("release:temp_ref");
      return options.tempRefCleanup ?? "removed";
    },
    inspectDisposableWorktree: () =>
      existingWorktree === undefined
        ? worktreeExists
          ? { exists: true, branch: undefined, head: input.submittedSha, dirty: false }
          : { exists: false }
        : { exists: true, ...existingWorktree },
    removeDisposableWorktree: () => {
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
    isDisposableWorktreeRemoved: () => !worktreeExists && existingWorktree === undefined,
  }));

  const module = await import("../../src/change/validation/createValidationWorkspace.js");

  return module.createValidationWorkspace;
};
