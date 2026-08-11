import { Effect } from "effect";

const save = (_value: number): Promise<void> => Promise.resolve();

export const program = Effect.succeed(1).pipe(Effect.map(save));
