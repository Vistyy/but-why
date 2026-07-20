import { existsSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { it as ordinaryIt, onTestFinished } from "vitest";

import { createTestWorkspace, testWorkspace } from "./support/testWorkspace.js";

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
