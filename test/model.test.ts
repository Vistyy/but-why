import { Effect } from "effect";
import { expect, it } from "vitest";
import { parseModelSlug, resolveReviewModel } from "../src/model.js";

it("rejects an unknown explicit model instead of falling back to another Pi model", async () => {
  const parsed = await Effect.runPromise(parseModelSlug("missing-review-provider/unknown-model"));
  const result = await Effect.runPromise(Effect.result(resolveReviewModel(parsed)));

  expect(result._tag).toBe("Failure");

  if (result._tag === "Failure")
    expect(result.failure.message).toContain(
      "Unknown reviewer model: missing-review-provider/unknown-model",
    );
});
