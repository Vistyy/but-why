import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeTokenUsage } from "../src/contracts/tokenUsage.js";

describe("token usage contract", () => {
  it("normalizes optional token buckets", async () => {
    await expect(
      Effect.runPromise(decodeTokenUsage({ inputTokens: 10, outputTokens: 4 })),
    ).resolves.toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 4,
      totalTokens: 14,
    });
  });

  it("produces no usage record when the payload is absent", async () => {
    await expect(Effect.runPromise(decodeTokenUsage(undefined))).resolves.toBeUndefined();
  });

  it("preserves complete canonical token buckets", async () => {
    const usage = {
      inputTokens: 10,
      cachedInputTokens: 3,
      outputTokens: 4,
      totalTokens: 20,
    };

    await expect(Effect.runPromise(decodeTokenUsage(usage))).resolves.toEqual(usage);
  });

  it.each([
    ["inputTokens", { outputTokens: 4 }],
    ["outputTokens", { inputTokens: 10 }],
  ])("returns a typed tooling error when %s is missing", async (field, payload) => {
    const error = await Effect.runPromise(Effect.flip(decodeTokenUsage(payload)));

    expect(error._tag).toBe("TokenUsageContractFailed");
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({ path: [field], actual: undefined }),
    );
  });

  it.each([
    ["negative", { inputTokens: -1, outputTokens: 4 }],
    ["fractional", { inputTokens: 10, outputTokens: 1.5 }],
    ["invalid optional", { inputTokens: 10, cachedInputTokens: -1, outputTokens: 4 }],
  ])("rejects %s token counts", async (_name, payload) => {
    const error = await Effect.runPromise(Effect.flip(decodeTokenUsage(payload)));

    expect(error._tag).toBe("TokenUsageContractFailed");
    expect(error.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects unknown token usage buckets", async () => {
    const error = await Effect.runPromise(
      Effect.flip(decodeTokenUsage({ inputTokens: 10, outputTokens: 4, cacheTokens: 3 })),
    );

    expect(error._tag).toBe("TokenUsageContractFailed");
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({ path: ["cacheTokens"], actual: 3, message: "Unknown key." }),
    );
  });
});
