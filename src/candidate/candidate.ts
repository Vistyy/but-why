export type CandidateRecord = {
  readonly id: string;
  readonly changeId: string;
  readonly selectedBaseRef: string;
  readonly resolvedTargetSha: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly createdAt: string;
};
