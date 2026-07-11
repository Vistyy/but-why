import type { CandidateRecord } from "./candidate.js";

export type CandidateStore = {
  readonly captureCandidate: (input: CaptureCandidateInput) => CaptureCandidateResult;
  readonly getCandidateById: (candidateId: string) => CandidateRecord | undefined;
  readonly listCandidatesForChange: (changeId: string) => readonly CandidateRecord[];
};

export type CaptureCandidateInput = {
  readonly changeId: string;
  readonly selectedBaseRef: string;
  readonly resolvedTargetSha: string;
  readonly comparisonBaseSha: string;
  readonly headSha: string;
  readonly now: string;
};

export type CaptureCandidateResult =
  | { readonly ok: true; readonly reused: boolean; readonly candidate: CandidateRecord }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_closed"
        | "change_base_ref_conflict"
        | "candidate_provenance_conflict";
      readonly candidate?: CandidateRecord;
    };
