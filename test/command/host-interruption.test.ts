import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  type HostInterruptionResult,
  type HostInterruptionSignal,
  hostInterruptionExitCode,
  runWithHostInterruption,
} from "../../src/command/hostInterruption.js";

type TestHost = {
  readonly once: (signal: HostInterruptionSignal, listener: () => void) => void;
  readonly off: (signal: HostInterruptionSignal, listener: () => void) => void;
  readonly emit: (signal: HostInterruptionSignal) => void;
  readonly listeners: ReadonlyMap<HostInterruptionSignal, () => void>;
};

const testHost = (): TestHost => {
  const registered = new Map<HostInterruptionSignal, () => void>();
  return {
    once: (signal, listener) => registered.set(signal, listener),
    off: (signal, listener) => {
      if (registered.get(signal) === listener) registered.delete(signal);
    },
    emit: (signal) => {
      const listener = registered.get(signal);
      registered.delete(signal);
      listener?.();
    },
    listeners: registered,
  };
};

describe("host interruption boundary", () => {
  it("captures the signal and finalizes before reporting completion", async () => {
    const host = testHost();
    const events: string[] = [];
    let completion: HostInterruptionResult<void> | undefined;
    const running = runWithHostInterruption(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => events.push("finalized")));
          yield* Effect.never;
        }),
      ),
      (result) => {
        events.push("completed");
        completion = result;
      },
      host,
    );

    host.emit("SIGTERM");
    await running;

    expect(events).toEqual(["finalized", "completed"]);
    expect(completion).toMatchObject({ ok: false, signal: "SIGTERM" });
    expect(host.listeners.size).toBe(0);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("maps %s to its conventional exit code", (signal, exitCode) => {
    expect(hostInterruptionExitCode(signal, 1)).toBe(exitCode);
  });

  it("preserves the fallback exit code without an interruption", () => {
    expect(hostInterruptionExitCode(undefined, 7)).toBe(7);
  });
});
