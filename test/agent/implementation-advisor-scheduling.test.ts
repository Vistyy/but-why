import { describe, expect, it } from "vitest";
import { createAdvisorActivityScheduler } from "../../extensions/implementation-advisor/runtime.js";

describe("Implementation Advisor scheduling", () => {
  it("serializes evaluation and retains the complete pending batch", async () => {
    const batches: string[][] = [];
    let release: (() => void) | undefined;
    const scheduler = createAdvisorActivityScheduler<string>(async (activities) => {
      batches.push([...activities]);
      if (batches.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    const first = scheduler.add("turn:1");
    void scheduler.add("turn:2");
    void scheduler.add("turn:3");
    expect(scheduler.active).toBe(true);
    release?.();
    await first;
    expect(batches).toEqual([["turn:1"], ["turn:2", "turn:3"]]);
    expect(scheduler.active).toBe(false);
  });
});
