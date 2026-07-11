export type CommitCandidateCaptureInput = {
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly expectedChangeId?: string;
  readonly rebindFromRef?: string;
  readonly selectedBaseRef: string;
  readonly resolvedTargetSha: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly now: string;
};

export type CommitCandidateCaptureResult =
  | {
      readonly ok: true;
      readonly changeId: string;
      readonly candidateId: string;
      readonly reused: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_closed"
        | "change_binding_conflict"
        | "destination_branch_has_history"
        | "base_ref_conflict"
        | "candidate_provenance_conflict";
    };

export type ChangeCandidateCaptureStore = {
  readonly commitCapture: (input: CommitCandidateCaptureInput) => CommitCandidateCaptureResult;
};
