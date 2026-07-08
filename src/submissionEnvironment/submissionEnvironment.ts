import type { Effect } from "effect";

import type { GitHubPrTarget } from "../validationRun/validationRun.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import type {
  ActiveValidationWorkspace,
  ActiveValidationWorkspaceResult,
  ValidationSandboxMode,
  ValidationWorkspaceSetup,
  ValidationWorkspaceToolingError,
} from "../validation/validationWorkspace.js";

export type SubmissionEnvironment = {
  readonly readSubmittedCodeCandidate: () => SubmittedCodeCandidateResult;
  readonly createValidationWorkspaceForValidationRun: (
    input: CreateValidationWorkspaceForValidationRunInput,
  ) => Effect.Effect<CreateValidationWorkspaceForValidationRunResult>;
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

export type CreateValidationWorkspaceForValidationRunInput = {
  readonly validationRunId: string;
  readonly commitSha: string;
  readonly sandboxMode: ValidationSandboxMode;
  readonly now: string;
  readonly runInWorkspace?: (
    workspace: ActiveValidationWorkspace,
  ) => Effect.Effect<ActiveValidationWorkspaceResult, ValidationToolingFailure>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: ValidationWorkspaceToolingError,
  ) => Effect.Effect<void>;
};

export type CreateValidationWorkspaceForValidationRunResult =
  | {
      readonly ok: true;
      readonly validationWorkspace: ValidationWorkspaceSetup;
      readonly activeWorkspaceResult?: ActiveValidationWorkspaceResult;
    }
  | {
      readonly ok: false;
      readonly toolingError: ValidationWorkspaceToolingError;
    }
  | {
      readonly ok: false;
      readonly toolingFailure: ValidationToolingFailure;
    };
