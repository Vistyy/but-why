export type ImplementationBlockerSource =
  | { readonly type: "implementer" }
  | { readonly type: "stall_detection"; readonly stallDetectionId: number };

export type ImplementationBlocker = {
  readonly id: number;
  readonly changeId: string;
  readonly content: string;
  readonly source: ImplementationBlockerSource;
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

export const latestResolvedBlockerId = (history: ImplementationBlockerHistory): number | null =>
  [...history.blockers]
    .filter((blocker) => blocker.resolution !== null)
    .sort((left, right) => right.id - left.id)[0]?.id ?? null;
