import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  effectiveThinkingLevel,
  parseModelSlug,
  parseThinkingLevel,
  resolveReviewModel,
} from "../src/model.js";

it("rejects an unknown explicit model instead of falling back to another Pi model", async () => {
  const parsed = await Effect.runPromise(parseModelSlug("missing-review-provider/unknown-model"));
  const result = await Effect.runPromise(Effect.result(resolveReviewModel(parsed)));

  expect(result._tag).toBe("Failure");

  if (result._tag === "Failure")
    expect(result.failure.message).toContain(
      "Unknown reviewer model: missing-review-provider/unknown-model",
    );
});

it("uses Pi's supported thinking level for the selected model", async () => {
  expect(await Effect.runPromise(parseThinkingLevel(undefined))).toBe("medium");
  expect(await Effect.runPromise(parseThinkingLevel("max"))).toBe("max");
  const invalid = await Effect.runPromise(Effect.result(parseThinkingLevel("unlimited")));
  expect(invalid._tag).toBe("Failure");

  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const model = runtime.getModels().find((candidate) => !candidate.reasoning);

  if (model === undefined) throw new Error("Expected a non-reasoning Pi model");
  const slug = { provider: model.provider, id: model.id, value: `${model.provider}/${model.id}` };
  expect(effectiveThinkingLevel({ slug, model, runtime }, "max")).toBe("off");
});
