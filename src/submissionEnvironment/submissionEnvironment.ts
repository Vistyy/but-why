import type { GitHubPrTarget } from "../run/run.js";
import type {
  ValidationWorkspaceSetup,
  ValidationWorkspaceToolingError,
} from "../validation/createValidationWorkspace.js";

export type SubmissionEnvironment = {
  readonly readSubmittedCodeCandidate: () => SubmittedCodeCandidateResult;
  readonly createValidationWorkspaceForRun: (
    input: CreateValidationWorkspaceForRunInput,
  ) => Promise<CreateValidationWorkspaceForRunResult>;
};

export type SubmittedCodeCandidate = {
  readonly branch: string;
  readonly commitSha: string;
  readonly prTarget: GitHubPrTarget;
};

export type SubmittedCodeCandidateResult =
  | {
      readonly ok: true;
      readonly candidate: SubmittedCodeCandidate;
    }
  | {
      readonly ok: false;
      readonly kind: "preflight_rejection";
      readonly code: SubmissionEnvironmentRejectionCode;
      readonly branch?: string;
    }
  | {
      readonly ok: false;
      readonly kind: "tooling_error";
    };

export type SubmissionEnvironmentRejectionCode =
  | "CURRENT_BRANCH_REQUIRED"
  | "WORKTREE_NOT_CLEAN"
  | "PROTECTED_BRANCH"
  | "PR_TARGET_NOT_FOUND";

export type CreateValidationWorkspaceForRunInput = {
  readonly runId: string;
  readonly commitSha: string;
  readonly now: string;
};

export type CreateValidationWorkspaceForRunResult =
  | {
      readonly ok: true;
      readonly validationWorkspace: ValidationWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly toolingError: ValidationWorkspaceToolingError;
    };
