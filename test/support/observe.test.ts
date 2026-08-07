import { describe, expect, it } from "vitest";

import { ObservationDeadlineExceeded, observeUntil } from "./observe.js";

describe("deadline-bounded observation", () => {
  it("returns immediately when the observed state is already ready", async () => {
    let observations = 0;
    const result = await observeUntil({
      description: "the immediate readiness marker",
      observe: () => {
        observations += 1;
        return "ready";
      },
      timeoutMs: 100,
    });

    expect(result).toBe("ready");
    expect(observations).toBe(1);
  });

  it("observes eventual readiness without asserting a fixed delay", async () => {
    let observations = 0;
    const result = await observeUntil({
      description: "the eventual readiness marker",
      observe: () => {
        observations += 1;
        return observations >= 3;
      },
      timeoutMs: 100,
      pollIntervalMs: 1,
    });

    expect(result).toBe(true);
    expect(observations).toBe(3);
  });

  it("reports the awaited condition and elapsed deadline when readiness never appears", async () => {
    await expect(
      observeUntil({
        description: "the missing readiness marker",
        observe: () => false,
        timeoutMs: 5,
        pollIntervalMs: 1,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ObservationDeadlineExceeded);
      expect((error as Error).message).toMatch(/missing readiness marker.*deadline was 5 ms/i);
      return true;
    });
  });

  it("bounds an observation that never settles", async () => {
    await expect(
      observeUntil({
        description: "the stalled readiness observer",
        observe: () => new Promise<boolean>(() => undefined),
        timeoutMs: 5,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ObservationDeadlineExceeded);
      expect((error as Error).message).toContain("stalled readiness observer");
      return true;
    });
  });
});
