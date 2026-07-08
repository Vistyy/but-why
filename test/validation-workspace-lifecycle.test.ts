import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { createValidationWorkspace as createValidationWorkspaceType } from "../src/validation/createValidationWorkspace.js";

const input = {
  repoRoot: "/repo",
  validationRunId: "by-1-test.1",
  submittedSha: "abc123",
  copyFiles: [],
};

const tempRefName = "refs/but-why/validation-runs/by-1-test.1/validation";
const expectedWorktreePath =
  "/repo/.sandcastle/worktrees/refs-but-why-validation-runs-by-1-test.1-validation";

describe("Validation Workspace scoped lifecycle", () => {
  it("cleans up a successful workspace in reverse acquisition order", async () => {
    const events: string[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events);

    const result = await Effect.runPromise(createValidationWorkspace(input));

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
  });

  it("does not clean up when temp ref acquisition fails", async () => {
    const events: string[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events, {
      tempRefFailure: "bad ref",
    });

    const result = await Effect.runPromise(createValidationWorkspace(input));

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
  });

  it("cleans up the temp ref and partial worktree when worktree creation fails", async () => {
    const events: string[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events, {
      worktreeCreationFailure: "sandcastle failed",
    });

    const result = await Effect.runPromise(createValidationWorkspace(input));

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
  });

  it("keeps setup failure primary when cleanup also fails", async () => {
    const events: string[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events, {
      worktreeCreationFailure: "sandcastle failed",
      worktreeCleanup: "failed",
      tempRefCleanup: "failed",
    });

    const result = await Effect.runPromise(createValidationWorkspace(input));

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
  });

  it("runs acquired-resource cleanup when interrupted", async () => {
    const events: string[] = [];
    const recordedCleanupResults: unknown[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events, {
      neverFinishWorktreeCreation: true,
    });

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
      yield* Effect.promise(() => waitUntil(() => events.includes("acquire:worktree")));
      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program);

    expect(events).toEqual([
      "acquire:temp_ref",
      "acquire:worktree",
      "remove:worktree",
      "release:temp_ref",
    ]);
    expect(recordedCleanupResults).toEqual([{ worktree: "removed", tempRef: "removed" }]);
  });

  it("runs acquired-resource cleanup when the workflow defects", async () => {
    const events: string[] = [];
    const createValidationWorkspace = await loadCreateValidationWorkspace(events, {
      worktreeHeadFailure: true,
    });

    await expect(Effect.runPromise(createValidationWorkspace(input))).rejects.toThrow();

    expect(events).toEqual([
      "acquire:temp_ref",
      "acquire:worktree",
      "read:worktree_head",
      "close:worktree",
      "remove:worktree",
      "release:temp_ref",
    ]);
  });
});

type FakeOptions = {
  readonly tempRefFailure?: string;
  readonly worktreeCreationFailure?: string;
  readonly neverFinishWorktreeCreation?: boolean;
  readonly worktreeHeadFailure?: boolean;
  readonly worktreeCleanup?: "removed" | "failed";
  readonly tempRefCleanup?: "removed" | "failed";
};

const waitUntil = async (condition: () => boolean): Promise<void> => {
  while (!condition()) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

const loadCreateValidationWorkspace = async (
  events: string[],
  options: FakeOptions = {},
): Promise<typeof createValidationWorkspaceType> => {
  vi.resetModules();
  let worktreeExists = false;

  vi.doMock("@ai-hero/sandcastle", () => ({
    createSandbox: async () => {
      events.push("acquire:worktree");
      worktreeExists = true;

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

  vi.doMock("../src/validation/validationGitGlue.js", () => ({
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
      worktreeExists
        ? { exists: true, branch: undefined, head: input.submittedSha, dirty: false }
        : { exists: false },
    removeValidationWorktree: () => {
      events.push("remove:worktree");
      worktreeExists = false;
      return options.worktreeCleanup !== "failed";
    },
  }));

  const module = await import("../src/validation/createValidationWorkspace.js");

  return module.createValidationWorkspace;
};
