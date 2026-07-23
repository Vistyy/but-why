import { Effect, Schema } from "effect";

import { TokenUsageContractFailed } from "../change/validation/validationToolingFailures.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";

const tokenCountSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.annotations({ identifier: "non-negative integer" }),
);

const tokenUsageInputSchema = Schema.Struct({
  inputTokens: tokenCountSchema,
  cachedInputTokens: Schema.optional(tokenCountSchema),
  outputTokens: tokenCountSchema,
  totalTokens: Schema.optional(tokenCountSchema),
});

export type TokenUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
};

export const decodeTokenUsage = (
  input: unknown | undefined,
): Effect.Effect<TokenUsage | undefined, TokenUsageContractFailed> => {
  if (input === undefined) {
    return Effect.succeed(undefined);
  }

  return Schema.decodeUnknown(tokenUsageInputSchema, { onExcessProperty: "error" })(input).pipe(
    Effect.map((usage) => ({
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
    })),
    Effect.mapError((error) => {
      const diagnostics = contractDiagnostics(error, input);
      return new TokenUsageContractFailed({
        operationName: "decode_token_usage",
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      });
    }),
  );
};
