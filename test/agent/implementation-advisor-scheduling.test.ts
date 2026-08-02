import { describe, expect, it } from "vitest";
import {
  createAdvisorActivityScheduler,
  deliverAdvisorAdvice,
  type Evidence,
} from "../../extensions/implementation-advisor/index.js";

describe("Implementation Advisor scheduling and delivery", () => {
  it("coalesces activity while one evaluation is active", async () => {
    const batches: Evidence[][] = [];
    let release: (() => void) | undefined;
    const scheduler = createAdvisorActivityScheduler<Evidence>(
      async (_batch, activity) => {
        batches.push([...activity]);
        if (batches.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      () => undefined,
    );
    const first: Evidence = {
      activity: "write",
      reference: "write:1",
      input: {},
      result: [],
      failed: false,
    };
    const second: Evidence = {
      activity: "write",
      reference: "write:2",
      input: {},
      result: [],
      failed: false,
    };
    scheduler.add(first);
    const active = scheduler.settle();
    scheduler.add(second);
    release?.();
    await active;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(batches.map((batch) => batch.map((item) => item.reference))).toEqual([
      ["write:1"],
      ["write:2"],
    ]);
  });

  it("uses non-waking delivery modes for active and idle sessions", () => {
    const deliveries: unknown[] = [];
    const note = {
      ruleId: "verification.proportional-evidence" as const,
      message: "Review.",
      evidence: ["write:1"],
      activityBatch: 1,
    };
    deliverAdvisorAdvice((message, options) => deliveries.push({ message, options }), false, note);
    deliverAdvisorAdvice((message, options) => deliveries.push({ message, options }), true, note);
    expect(deliveries).toHaveLength(2);
    expect(
      deliveries.map(
        (delivery) =>
          (delivery as { options: { triggerTurn: boolean; deliverAs: string } }).options,
      ),
    ).toEqual([
      { triggerTurn: false, deliverAs: "followUp" },
      { triggerTurn: false, deliverAs: "nextTurn" },
    ]);
  });
});
