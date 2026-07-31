import { expect, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { describe } from "vitest";

import {
  ExecutionLockUnavailable,
  openSqliteExecutionLock,
} from "../../src/sqlite/sqliteExecutionLock.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("SQLite execution lock", () => {
  it.effect("excludes the same owner and key until the first operation releases it", () =>
    Effect.gen(function* () {
      const lock = openSqliteExecutionLock({ commonDirectory: createTestWorkspace() });
      const acquired = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* Effect.fork(
        lock.withLock({
          owner: "change_submission",
          key: "change-1",
          effect: Effect.zipRight(Deferred.succeed(acquired, undefined), Deferred.await(release)),
        }),
      );

      yield* Deferred.await(acquired);
      const blocked = yield* lock
        .withLock({
          owner: "change_submission",
          key: "change-1",
          effect: Effect.succeed("second"),
        })
        .pipe(Effect.either);
      expect(blocked._tag).toBe("Left");
      if (blocked._tag === "Left") {
        expect(blocked.left).toBeInstanceOf(ExecutionLockUnavailable);
      }

      yield* Deferred.succeed(release, undefined);
      expect(yield* first).toBeUndefined();
      expect(
        yield* lock.withLock({
          owner: "change_submission",
          key: "change-1",
          effect: Effect.succeed("after-release"),
        }),
      ).toBe("after-release");
    }),
  );

  it.effect("keeps independent owner and key locks available", () =>
    Effect.gen(function* () {
      const lock = openSqliteExecutionLock({ commonDirectory: createTestWorkspace() });
      const acquired = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* Effect.fork(
        lock.withLock({
          owner: "change_submission",
          key: "change-1",
          effect: Effect.zipRight(Deferred.succeed(acquired, undefined), Deferred.await(release)),
        }),
      );

      yield* Deferred.await(acquired);
      expect(
        yield* lock.withLock({
          owner: "change_submission",
          key: "change-2",
          effect: Effect.succeed("other-key"),
        }),
      ).toBe("other-key");
      expect(
        yield* lock.withLock({
          owner: "validation_run",
          key: "change-1",
          effect: Effect.succeed("other-owner"),
        }),
      ).toBe("other-owner");

      yield* Deferred.succeed(release, undefined);
      yield* first;
    }),
  );
});
