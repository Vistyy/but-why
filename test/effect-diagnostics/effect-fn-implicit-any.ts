import { Effect } from "effect";

export const program = Effect.fn("program")((input) => Effect.succeed(input));
