export type TaskContextSnapshotV1 = {
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};
