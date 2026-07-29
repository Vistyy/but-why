export type ImplementationBlocker = {
  readonly id: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly reportedAt: string;
  readonly content: string;
  readonly resolvedAt: string | null;
  readonly resolution: ImplementationBlockerResolution | null;
};

export type ImplementationBlockerResolution = {
  readonly id: string;
  readonly blockerId: string;
  readonly recordedAt: string;
  readonly content: string;
};

export type ImplementationBlockerHistory = {
  readonly blockers: readonly ImplementationBlocker[];
  readonly resolutions: readonly ImplementationBlockerResolution[];
  readonly active: ImplementationBlocker | null;
};
