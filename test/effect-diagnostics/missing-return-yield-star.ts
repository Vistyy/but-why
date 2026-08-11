import { Effect } from "effect";

export const program = Effect.gen(function* () {
  yield* Effect.log("before");
  yield* Effect.fail("boom");
});
