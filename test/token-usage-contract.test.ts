import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { decodeTokenUsage } from "../src/contracts/tokenUsage.js";

describe("token usage contract", () => {
  it.effect("normalizes optional token buckets", () =>
    Effect.gen(function* () {
      const usage = yield* decodeTokenUsage({ inputTokens: 10, outputTokens: 4 });

      expect(usage).toEqual({
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 4,
        totalTokens: 14,
      });
    }),
  );

  it.effect("produces no usage record when the payload is absent", () =>
    Effect.gen(function* () {
      const usage = yield* decodeTokenUsage(undefined);

      expect(usage).toBeUndefined();
    }),
  );

  it.effect("preserves complete canonical token buckets", () =>
    Effect.gen(function* () {
      const usage = {
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 4,
        totalTokens: 20,
      };

      const decoded = yield* decodeTokenUsage(usage);

      expect(decoded).toEqual(usage);
    }),
  );

  const missingRequiredBuckets: ReadonlyArray<readonly [field: string, payload: unknown]> = [
    ["inputTokens", { outputTokens: 4 }],
    ["outputTokens", { inputTokens: 10 }],
  ];
  for (const [field, payload] of missingRequiredBuckets) {
    it.effect(`returns a typed tooling error when ${field} is missing`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodeTokenUsage(payload));

        expect(error._tag).toBe("TokenUsageContractFailed");
        expect(error.diagnostics).toContainEqual(
          expect.objectContaining({ path: [field], actual: undefined }),
        );
      }),
    );
  }

  const invalidTokenCounts: ReadonlyArray<readonly [name: string, payload: unknown]> = [
    ["negative", { inputTokens: -1, outputTokens: 4 }],
    ["fractional", { inputTokens: 10, outputTokens: 1.5 }],
    ["invalid optional", { inputTokens: 10, cachedInputTokens: -1, outputTokens: 4 }],
  ];
  for (const [name, payload] of invalidTokenCounts) {
    it.effect(`rejects ${name} token counts`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodeTokenUsage(payload));

        expect(error._tag).toBe("TokenUsageContractFailed");
        expect(error.diagnostics.length).toBeGreaterThan(0);
      }),
    );
  }

  it.effect("rejects unknown token usage buckets", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeTokenUsage({ inputTokens: 10, outputTokens: 4, cacheTokens: 3 }),
      );

      expect(error._tag).toBe("TokenUsageContractFailed");
      expect(error.diagnostics).toContainEqual(
        expect.objectContaining({ path: ["cacheTokens"], actual: 3, message: "Unknown key." }),
      );
    }),
  );
});
