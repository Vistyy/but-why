import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type RuleAssignment, runReviewers } from "../src/reviewers.js";

const rules = (count: number): RuleAssignment[] =>
  Array.from({ length: count }, (_, i) => ({
    identity: `r${i}`,
    provenance: "test",
    prompt: `p${i}`,
  }));

const run = (items: RuleAssignment[], reviewer: Parameters<typeof runReviewers>[2], options = {}) =>
  Effect.runPromise(runReviewers(items, "/checkout", reviewer, undefined, options));

describe("Effect reviewer orchestration", () => {
  it("limits concurrency to three and returns input order and untouched text", async () => {
    let active = 0;
    let maximum = 0;

    const output = await run(rules(7), async ({ prompt }) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      active--;

      return ` ${prompt}\n`;
    });

    expect(maximum).toBe(3);
    expect(output.results.map((r) => r.output)).toEqual(rules(7).map((r) => ` ${r.prompt}\n`));
    expect(output.uncertain).toBe(false);
  });

  it("retains siblings when one reviewer fails", async () => {
    const output = await run(rules(3), async ({ prompt }) => {
      if (prompt === "p1") throw new Error("failed");

      return prompt;
    });

    expect(output.results.map((r) => r.output)).toEqual(["p0", null, "p2"]);
    expect(output.results[1]?.failure?._tag).toBe("ReviewerFailed");
  });

  it("interrupts the result promptly and marks unsettled activity uncertain", async () => {
    const controller = new AbortController();

    const pending = Effect.runPromise(
      runReviewers(
        rules(1),
        "/checkout",
        () =>
          new Promise(() => {
            /* deliberately uncooperative */
          }),
        controller.signal,
        {
          deadlineMs: 1_000,
          settleMs: 5,
        },
      ),
    );

    controller.abort();
    const output = await pending;
    expect(output.results[0]?.failure?._tag).toBe("ReviewerInterrupted");
    expect(output.uncertain).toBe(true);
  });

  it("does not start queued sessions when an uncooperative reviewer remains active", async () => {
    let started = 0;

    const output = await run(
      rules(6),
      () => {
        started++;

        return new Promise(() => {
          /* deliberately uncooperative */
        });
      },
      { deadlineMs: 5, settleMs: 5 },
    );

    expect(started).toBe(3);
    expect(output.uncertain).toBe(true);
    expect(output.results.slice(3).map(({ failure }) => failure?._tag)).toEqual([
      "ReviewerSkipped",
      "ReviewerSkipped",
      "ReviewerSkipped",
    ]);
  });

  it("keeps a timed-out activity's slot occupied while other reviewers finish during settlement", async () => {
    let active = 0;
    let maximum = 0;

    const output = await run(
      rules(6),
      ({ prompt }) => {
        active++;
        maximum = Math.max(maximum, active);

        if (prompt === "p0")
          return new Promise(() => {
            /* deliberately uncooperative */
          });

        const duration = prompt === "p3" || prompt === "p4" ? 225 : 75;

        return new Promise((resolve) => {
          setTimeout(() => {
            active--;
            resolve(prompt);
          }, duration);
        });
      },
      { deadlineMs: 250, settleMs: 250 },
    );

    expect(maximum).toBe(3);
    expect(output.results[0]?.failure?._tag).toBe("ReviewerTimedOut");
    expect(output.results[5]?.output).toBe("p5");
    expect(output.uncertain).toBe(true);
  });

  it("reports cooperative and uncooperative timed-out activity distinctly", async () => {
    const cooperative = await run(
      rules(1),
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      { deadlineMs: 5, settleMs: 5 },
    );

    expect(cooperative.results[0]?.failure?._tag).toBe("ReviewerTimedOut");
    expect(cooperative.uncertain).toBe(false);

    const uncooperative = await run(
      rules(1),
      () =>
        new Promise(() => {
          /* deliberately uncooperative */
        }),
      {
        deadlineMs: 5,
        settleMs: 5,
      },
    );

    expect(uncooperative.results[0]?.failure?._tag).toBe("ReviewerTimedOut");
    expect(uncooperative.uncertain).toBe(true);
  });
});
