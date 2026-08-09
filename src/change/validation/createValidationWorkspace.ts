import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  createDisposableWorkspace,
  type ActiveDisposableWorkspace,
  type CreateDisposableWorkspaceResult,
  type DisposableWorkspaceSetup,
  type DisposableWorkspaceToolingError,
} from "../../workspace/disposableWorkspace.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";
import type {
  ActiveValidationWorkspace,
  ActiveValidationWorkspaceResult,
  ValidationWorkspaceCleanupResult,
  ValidationWorkspaceSetup,
  ValidationWorkspaceToolingError,
} from "./validationWorkspace.js";
import { validationTempRefName } from "./validationWorkspacePath.js";

export type CreateValidationWorkspaceInput = {
  readonly repoRoot: string;
  readonly validationRunId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceSetup?: (
    setup: ValidationWorkspaceSetup,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: ValidationWorkspaceToolingError,
  ) => Effect.Effect<void, unknown>;
  readonly runInWorkspace?: (
    workspace: ActiveValidationWorkspace,
  ) => Effect.Effect<
    ActiveValidationWorkspaceResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
};

export type CreateValidationWorkspaceResult =
  | {
      readonly ok: true;
      readonly setup: ValidationWorkspaceSetup;
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

export const createValidationWorkspace = (
  input: CreateValidationWorkspaceInput,
): Effect.Effect<CreateValidationWorkspaceResult, RepositoryStorageError> => {
  const recordWorkspaceSetup = input.recordWorkspaceSetup;
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;
  const runInWorkspace = input.runInWorkspace;
  return createDisposableWorkspace<
    ActiveValidationWorkspaceResult,
    ValidationToolingFailure | RepositoryStorageError
  >({
    repoRoot: input.repoRoot,
    runId: input.validationRunId,
    tempRefName: validationTempRefName(input.validationRunId),
    submittedSha: input.submittedSha,
    copyFiles: input.copyFiles,
    ...(recordWorkspaceSetup === undefined
      ? {}
      : {
          recordWorkspaceSetup: (setup) => recordWorkspaceSetup(toValidationWorkspaceSetup(setup)),
        }),
    ...(recordInterruptedCleanupResult === undefined
      ? {}
      : {
          recordInterruptedCleanupResult: (toolingError) =>
            recordInterruptedCleanupResult(toValidationWorkspaceToolingError(toolingError)),
        }),
    ...(runInWorkspace === undefined
      ? {}
      : {
          runInWorkspace: (workspace) => runInWorkspace(toActiveValidationWorkspace(workspace)),
        }),
  }).pipe(
    Effect.map((result): CreateValidationWorkspaceResult => toValidationWorkspaceResult(result)),
    Effect.catchTags({
      ValidationWorkspaceSetupFailed: toolingFailureResult,
      InfrastructureToolingFailed: toolingFailureResult,
      GitToolingFailed: toolingFailureResult,
      SandcastleToolingFailed: toolingFailureResult,
      PrepareCommandExecutionToolingFailed: toolingFailureResult,
      CheckCommandExecutionToolingFailed: toolingFailureResult,
      ReviewerOutputContractFailed: toolingFailureResult,
      TokenUsageContractFailed: toolingFailureResult,
    }),
  );
};

const toolingFailureResult = (toolingFailure: ValidationToolingFailure) =>
  Effect.succeed({ ok: false as const, toolingFailure });

const toActiveValidationWorkspace = (
  workspace: ActiveDisposableWorkspace,
): ActiveValidationWorkspace => ({
  sandbox: workspace.sandbox,
  worktreePath: workspace.worktreePath,
});

const toValidationWorkspaceSetup = (setup: DisposableWorkspaceSetup): ValidationWorkspaceSetup => ({
  validationRunId: setup.runId,
  tempRefName: setup.tempRefName,
  submittedSha: setup.submittedSha,
  worktreeHead: setup.worktreeHead,
  ...(setup.worktreePath === undefined ? {} : { worktreePath: setup.worktreePath }),
  cleanupResult: toCleanupResult(setup.cleanupResult),
});

const toValidationWorkspaceToolingError = (
  toolingError: DisposableWorkspaceToolingError,
): ValidationWorkspaceToolingError => ({
  operationName: validationOperationName(toolingError.operationName),
  tempRefName: toolingError.tempRefName,
  submittedSha: toolingError.submittedSha,
  ...(toolingError.worktreePath === undefined ? {} : { worktreePath: toolingError.worktreePath }),
  errorMessage: validationErrorMessage(toolingError.errorMessage),
  cleanupResult: toCleanupResult(toolingError.cleanupResult),
});

const toValidationWorkspaceResult = (
  result: CreateDisposableWorkspaceResult<ActiveValidationWorkspaceResult>,
): CreateValidationWorkspaceResult => {
  if (result.ok) {
    return {
      ok: true,
      setup: toValidationWorkspaceSetup(result.setup),
      ...(result.activeWorkspaceResult === undefined
        ? {}
        : { activeWorkspaceResult: result.activeWorkspaceResult }),
    };
  }
  return { ok: false, toolingError: toValidationWorkspaceToolingError(result.toolingError) };
};

const toCleanupResult = (
  cleanupResult: DisposableWorkspaceSetup["cleanupResult"],
): ValidationWorkspaceCleanupResult => cleanupResult;

const validationOperationName = (operationName: string): string => {
  switch (operationName) {
    case "cleanup_disposable_workspace":
      return "cleanup_validation_workspace";
    case "disposable_workspace_interrupted":
      return "validation_workspace_interrupted";
    default:
      return operationName;
  }
};

const validationErrorMessage = (message: string): string =>
  message
    .replaceAll(
      "Disposable workspace already exists for a different run:",
      "Validation worktree already exists for a different Validation Run:",
    )
    .replaceAll(
      "Disposable workspace already exists for a different commit:",
      "Validation worktree already exists for a different commit:",
    )
    .replaceAll(
      "Disposable workspace already exists with uncommitted changes:",
      "Validation worktree already exists with uncommitted changes:",
    )
    .replaceAll("Disposable workspace temp ref", "Validation temp ref")
    .replaceAll("Disposable workspace HEAD", "Validation worktree HEAD")
    .replaceAll("Disposable workspace removal failed.", "Validation worktree removal failed.")
    .replaceAll(
      "Allowlisted disposable workspace file is missing:",
      "Allowlisted validation workspace file is missing:",
    )
    .replaceAll(
      "Disposable workspace cleanup failed after successful setup.",
      "Validation workspace cleanup failed after successful setup.",
    )
    .replaceAll(
      "Disposable workspace setup was interrupted.",
      "Validation workspace setup was interrupted.",
    );
