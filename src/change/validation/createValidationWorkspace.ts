import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  runDisposableExactCommitWorkspace,
  type RunDisposableExactCommitWorkspaceInput,
} from "../../disposableWorkspace/runDisposableExactCommitWorkspace.js";
import type {
  DisposableWorkspaceError,
  DisposableWorkspaceSetup,
} from "../../disposableWorkspace/disposableWorkspace.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";
import type {
  ActiveValidationWorkspace,
  ActiveValidationWorkspaceResult,
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
  ) => Effect.Effect<void>;
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
): Effect.Effect<CreateValidationWorkspaceResult, RepositoryStorageError> =>
  createValidationWorkspaceAdapter(input).pipe(
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

const createValidationWorkspaceAdapter = (
  input: CreateValidationWorkspaceInput,
): Effect.Effect<
  CreateValidationWorkspaceResult,
  ValidationToolingFailure | RepositoryStorageError
> => {
  let activeWorkspaceResult: ActiveValidationWorkspaceResult | undefined;

  return Effect.gen(function* () {
    const workspaceInput: RunDisposableExactCommitWorkspaceInput<
      ValidationToolingFailure | RepositoryStorageError
    > = {
      repoRoot: input.repoRoot,
      workspaceRef: validationTempRefName(input.validationRunId),
      commitSha: input.submittedSha,
      copyFiles: input.copyFiles,
      ...(input.recordWorkspaceSetup === undefined
        ? {}
        : {
            recordWorkspaceSetup: (setup: DisposableWorkspaceSetup) =>
              input.recordWorkspaceSetup?.(validationSetup(input.validationRunId, setup)) ??
              Effect.void,
          }),
      ...(input.recordInterruptedCleanupResult === undefined
        ? {}
        : {
            recordInterruptedCleanupResult: (error: DisposableWorkspaceError) =>
              input.recordInterruptedCleanupResult?.(validationError(error)) ?? Effect.void,
          }),
      ...(input.runInWorkspace === undefined
        ? {}
        : {
            runInWorkspace: (workspace) => {
              const runInWorkspace = input.runInWorkspace;
              if (runInWorkspace === undefined) return Effect.void;
              return runInWorkspace(workspace).pipe(
                Effect.tap((result) =>
                  Effect.sync(() => {
                    activeWorkspaceResult = result;
                  }),
                ),
                Effect.asVoid,
              );
            },
          }),
    };
    const result = yield* runDisposableExactCommitWorkspace(workspaceInput);

    if (!result.ok) {
      return { ok: false, toolingError: validationError(result.toolingError) };
    }

    return {
      ok: true,
      setup: validationSetup(input.validationRunId, result.setup),
      ...(activeWorkspaceResult === undefined ? {} : { activeWorkspaceResult }),
    };
  });
};

const validationSetup = (
  validationRunId: string,
  setup: DisposableWorkspaceSetup,
): ValidationWorkspaceSetup => ({
  validationRunId,
  tempRefName: setup.tempRefName,
  submittedSha: setup.commitSha,
  worktreeHead: setup.worktreeHead,
  ...(setup.worktreePath === undefined ? {} : { worktreePath: setup.worktreePath }),
  cleanupResult: setup.cleanupResult,
});

const validationError = (error: DisposableWorkspaceError): ValidationWorkspaceToolingError => ({
  operationName: validationOperation(error.operationName),
  tempRefName: error.tempRefName,
  submittedSha: error.commitSha,
  ...(error.worktreePath === undefined ? {} : { worktreePath: error.worktreePath }),
  errorMessage: validationErrorMessage(error.errorMessage),
  cleanupResult: error.cleanupResult,
});

const validationOperation = (operationName: string): string => {
  if (operationName === "cleanup_disposable_workspace") return "cleanup_validation_workspace";
  if (operationName === "disposable_workspace_interrupted") {
    return "validation_workspace_interrupted";
  }
  return operationName;
};

const validationErrorMessage = (message: string): string =>
  message
    .replace("Allowlisted workspace file", "Allowlisted validation workspace file")
    .replace(
      "Disposable worktree already exists for a different workspace reference",
      "Validation worktree already exists for a different Validation Run",
    )
    .replace("Disposable worktree already exists", "Validation worktree already exists")
    .replace("Disposable worktree HEAD", "Validation worktree HEAD")
    .replace("Disposable worktree removal failed.", "Validation worktree removal failed.")
    .replace("requested commit", "submitted SHA")
    .replace(
      "Disposable workspace cleanup failed after successful use.",
      "Validation workspace cleanup failed after successful setup.",
    )
    .replace(
      "Disposable workspace use was interrupted.",
      "Validation workspace setup was interrupted.",
    );

const toolingFailureResult = (toolingFailure: ValidationToolingFailure) =>
  Effect.succeed({ ok: false as const, toolingFailure });
