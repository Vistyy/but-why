import type { AcceptanceContextSnapshotV1 } from "./acceptanceContext.js";
import type { ValidationPolicySnapshotV1 } from "./validationPolicySnapshot.js";

export type CandidateValidationRunState = "active" | "complete" | "superseded";
export type CandidateValidationRunOutcome = "passed" | "blocked" | "tooling_failed";

export type ValidationCopiedFile = {
  readonly path: string;
  readonly contentSha256: string;
};

export type CandidateValidationRunRecord = {
  readonly id: string;
  readonly changeId: string;
  readonly candidateId: string;
  readonly taskId: string | null;
  readonly state: CandidateValidationRunState;
  readonly outcome: CandidateValidationRunOutcome | null;
  readonly policySnapshot: ValidationPolicySnapshotV1;
  readonly policyFingerprint: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly acceptanceContextFingerprint: string | null;
  readonly copiedFiles: readonly ValidationCopiedFile[];
  readonly copiedFilesFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RequestValidationInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly taskId?: string;
  readonly policySnapshot: ValidationPolicySnapshotV1;
  readonly automaticFixing?: {
    readonly enabled: boolean;
    readonly command: string | null;
  };
  readonly acceptanceContext?: AcceptanceContextSnapshotV1 | null;
  readonly copiedFiles?: readonly ValidationCopiedFile[];
  readonly now: string;
};

export type RequestValidationResult =
  | {
      readonly ok: true;
      readonly kind: "active_reused" | "complete_reused" | "retry_created" | "new_created";
      readonly run: CandidateValidationRunRecord;
    }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_closed"
        | "candidate_not_found"
        | "candidate_change_mismatch"
        | "candidate_not_current"
        | "empty_acceptance_context"
        | "unsupported_acceptance_context_version";
    };

export type CompareValidationInputsInput = {
  readonly validationRunId: string;
  readonly candidateId: string;
  readonly policyFingerprint: string;
  readonly acceptanceContextFingerprint: string | null;
  readonly copiedFilesFingerprint: string;
};

export type CompareCurrentValidationInputsInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly policySnapshot: ValidationPolicySnapshotV1;
  readonly acceptanceContext?: AcceptanceContextSnapshotV1 | null;
  readonly copiedFiles?: readonly ValidationCopiedFile[];
};

export type CompareCurrentValidationInputsResult =
  | CompareValidationInputsResult
  | { readonly ok: false; readonly code: "current_validation_run_not_found" };

export type CompareValidationInputsResult =
  | {
      readonly ok: true;
      readonly matches: boolean;
      readonly differences: readonly (
        | "candidate"
        | "policy"
        | "acceptance_context"
        | "copied_files"
      )[];
    }
  | { readonly ok: false; readonly code: "validation_run_not_found" };

export type AcquireValidationRunLeaseInput = {
  readonly validationRunId: string;
  readonly holderId: string;
  readonly now: string;
  readonly nowMs: number;
};

export type ValidationRunLease = {
  readonly validationRunId: string;
  readonly leaseToken: string;
  readonly holderId: string;
  readonly acquiredAt: string;
  readonly renewedAt: string;
  readonly expiresAtMs: number;
};

export type AcquireValidationRunLeaseResult =
  | { readonly ok: true; readonly lease: ValidationRunLease }
  | {
      readonly ok: false;
      readonly code:
        | "validation_run_not_found"
        | "validation_run_not_active"
        | "lease_held"
        | "lease_expired_run";
      readonly retryable?: boolean;
    };

export type RenewValidationRunLeaseInput = {
  readonly validationRunId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly nowMs: number;
};

export type RenewValidationRunLeaseResult =
  | { readonly ok: true; readonly lease: ValidationRunLease }
  | {
      readonly ok: false;
      readonly code:
        | "validation_run_not_found"
        | "lease_not_found"
        | "lease_expired"
        | "lease_revoked"
        | "validation_run_not_active";
    };

export type RecordValidationEvidenceInput = {
  readonly validationRunId: string;
  readonly leaseToken: string;
  readonly phase: string;
  readonly producer?: string;
  readonly phaseStatus?: "passed" | "incomplete";
  readonly evidence: unknown;
  readonly outcome?: CandidateValidationRunOutcome;
  readonly now: string;
};

export type CurrentValidationState = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly validationRunId: string | null;
  readonly updatedAt: string;
};

export type ValidationRunEvidence = {
  readonly sequence: number;
  readonly phase: string;
  readonly producer: string;
  readonly phaseStatus: "passed" | "incomplete" | null;
  readonly evidence: unknown;
  readonly accepted: boolean;
  readonly createdAt: string;
};

export type CandidateValidationFinding = {
  readonly id: string;
  readonly validationRunId: string;
  readonly phase: string;
  readonly producer: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly accepted: boolean;
  readonly createdAt: string;
};

export type RecordValidationFindingInput = Omit<
  CandidateValidationFinding,
  "accepted" | "createdAt"
> & {
  readonly leaseToken: string;
  readonly now: string;
};

export type RecordValidationFindingResult =
  | { readonly ok: true; readonly applied: boolean }
  | {
      readonly ok: false;
      readonly code:
        | "validation_run_not_found"
        | "lease_not_found"
        | "lease_expired"
        | "lease_revoked"
        | "validation_run_not_active";
    };

export type RecordValidationEvidenceResult =
  | { readonly ok: true; readonly applied: boolean }
  | {
      readonly ok: false;
      readonly code:
        | "validation_run_not_found"
        | "lease_not_found"
        | "lease_expired"
        | "lease_revoked"
        | "validation_run_not_active"
        | "invalid_evidence";
    };

export type CandidateValidationRunStore = {
  readonly requestValidation: (input: RequestValidationInput) => RequestValidationResult;
  readonly getValidationRunById: (
    validationRunId: string,
  ) => CandidateValidationRunRecord | undefined;
  readonly getCurrentValidationRunForChange: (
    changeId: string,
  ) => CandidateValidationRunRecord | undefined;
  readonly getCurrentValidationState: (changeId: string) => CurrentValidationState | undefined;
  readonly listEvidence: (validationRunId: string) => readonly ValidationRunEvidence[];
  readonly listFindings: (validationRunId: string) => readonly CandidateValidationFinding[];
  readonly recordFinding: (input: RecordValidationFindingInput) => RecordValidationFindingResult;
  readonly compareValidationInputs: (
    input: CompareValidationInputsInput,
  ) => CompareValidationInputsResult;
  readonly compareCurrentValidationInputs: (
    input: CompareCurrentValidationInputsInput,
  ) => CompareCurrentValidationInputsResult;
  readonly acquireLease: (input: AcquireValidationRunLeaseInput) => AcquireValidationRunLeaseResult;
  readonly renewLease: (input: RenewValidationRunLeaseInput) => RenewValidationRunLeaseResult;
  readonly recordEvidence: (input: RecordValidationEvidenceInput) => RecordValidationEvidenceResult;
};

export const validationRunLeaseRenewalIntervalMs = 15_000;
export const validationRunLeaseDurationMs = 60_000;
