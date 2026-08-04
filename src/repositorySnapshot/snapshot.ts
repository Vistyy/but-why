import { Data, type Effect } from "effect";

export type SharedRepositoryStateSnapshot = {
  readonly snapshotPath: string;
};

export type SnapshotUseCases = {
  readonly create: () => Effect.Effect<SharedRepositoryStateSnapshot, SnapshotCreationFailed>;
};

export class SnapshotCreationFailed extends Data.TaggedError("SnapshotCreationFailed")<{
  readonly cause: unknown;
}> {}
