export type ImplementationBlocker = {
  readonly id: number;
  readonly changeId: string;
  readonly content: string;
  readonly resolution: ImplementationBlockerResolution | null;
};

export type ImplementationBlockerResolution = {
  readonly blockerId: number;
  readonly content: string;
};

export type ImplementationBlockerHistory = {
  readonly blockers: readonly ImplementationBlocker[];
  readonly resolutions: readonly ImplementationBlockerResolution[];
  readonly active: ImplementationBlocker | null;
};
