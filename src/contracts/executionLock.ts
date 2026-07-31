import { Data, type Effect } from "effect";

export class ExecutionLockUnavailable extends Data.TaggedError("ExecutionLockUnavailable")<{
  readonly owner: string;
  readonly key: string;
  readonly lockPath: string;
  readonly cause: unknown;
}> {}

export type ExecutionLock = {
  readonly withLock: <A, E, R>(input: {
    readonly owner: string;
    readonly key: string;
    readonly effect: Effect.Effect<A, E, R>;
  }) => Effect.Effect<A, E | ExecutionLockUnavailable, R>;
};
