import type { Effect } from "effect";

import type { ChangeState } from "../change.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
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

export type CandidateCaptureChange = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly state: ChangeState;
};

export type CandidateCapturePersistence = {
  readonly getChangeById: (
    changeId: string,
  ) => Effect.Effect<CandidateCaptureChange | undefined, RepositoryStorageError>;
  readonly getChangeByRepositoryBranch: (
    repositoryCommonDirectory: string,
    branchRef: string,
  ) => Effect.Effect<CandidateCaptureChange | undefined, RepositoryStorageError>;
  readonly commitCapture: (
    input: CommitCandidateCaptureInput,
  ) => Effect.Effect<CommitCandidateCaptureResult, RepositoryStorageError>;
};
