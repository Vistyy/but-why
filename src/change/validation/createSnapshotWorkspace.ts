import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  DisposableWorkspaceError,
  DisposableWorkspaceSetup,
} from "../../disposableWorkspace/disposableWorkspace.js";
import {
  type RunDisposableExactCommitWorkspaceInput,
  runDisposableExactCommitWorkspace,
} from "../../disposableWorkspace/runDisposableExactCommitWorkspace.js";
import type {
  ActiveSnapshotWorkspace,
  ActiveSnapshotWorkspaceResult,
  SnapshotWorkspaceSetup,
  SnapshotWorkspaceToolingError,
} from "./snapshotWorkspace.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";

export type CreateSnapshotWorkspaceInput = {
  readonly repoRoot: string;
  readonly validationRunId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceCleanup?: (
    cleanupResult: SnapshotWorkspaceSetup["cleanupResult"],
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: SnapshotWorkspaceToolingError,
  ) => Effect.Effect<void>;
  readonly runInWorkspace?: (
    workspace: ActiveSnapshotWorkspace,
  ) => Effect.Effect<
    ActiveSnapshotWorkspaceResult,
    ValidationToolingFailure | RepositoryStorageError
  >;
};

export type CreateSnapshotWorkspaceResult =
  | {
      readonly ok: true;
      readonly setup: SnapshotWorkspaceSetup;
      readonly activeWorkspaceResult?: ActiveSnapshotWorkspaceResult;
    }
  | { readonly ok: false; readonly toolingError: SnapshotWorkspaceToolingError }
  | { readonly ok: false; readonly toolingFailure: ValidationToolingFailure };

export const createSnapshotWorkspace = (
  input: CreateSnapshotWorkspaceInput,
): Effect.Effect<CreateSnapshotWorkspaceResult, RepositoryStorageError> =>
  createSnapshotWorkspaceAdapter(input).pipe(
    Effect.catchTags({
      SnapshotWorkspaceSetupFailed: toolingFailureResult,
      InfrastructureToolingFailed: toolingFailureResult,
      GitToolingFailed: toolingFailureResult,
      ReviewerProcessToolingFailed: toolingFailureResult,
      PrepareCommandExecutionToolingFailed: toolingFailureResult,
      CheckCommandExecutionToolingFailed: toolingFailureResult,
      ReviewerOutputContractFailed: toolingFailureResult,
      TokenUsageContractFailed: toolingFailureResult,
    }),
  );

const createSnapshotWorkspaceAdapter = (
  input: CreateSnapshotWorkspaceInput,
): Effect.Effect<
  CreateSnapshotWorkspaceResult,
  ValidationToolingFailure | RepositoryStorageError
> => {
  let activeWorkspaceResult: ActiveSnapshotWorkspaceResult | undefined;
  return Effect.gen(function* () {
    const workspaceInput: RunDisposableExactCommitWorkspaceInput<
      ValidationToolingFailure | RepositoryStorageError
    > = {
      repoRoot: input.repoRoot,
      workspaceId: input.validationRunId,
      commitSha: input.submittedSha,
      copyFiles: input.copyFiles,
      ...(input.recordWorkspaceCleanup === undefined
        ? {}
        : {
            recordWorkspaceCleanup: (cleanupResult) =>
              input.recordWorkspaceCleanup?.(cleanupResult) ?? Effect.void,
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
    if (!result.ok) return { ok: false, toolingError: validationError(result.toolingError) };
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
): SnapshotWorkspaceSetup => ({
  validationRunId,
  expectedCommitSha: setup.commitSha,
  ...(setup.workspaceHead === undefined ? {} : { workspaceHead: setup.workspaceHead }),
  worktreePath: setup.worktreePath,
  cleanupResult: setup.cleanupResult,
});

const validationError = (error: DisposableWorkspaceError): SnapshotWorkspaceToolingError => ({
  operationName: validationOperation(error.operationName),
  validationRunId: error.workspaceId,
  expectedCommitSha: error.commitSha,
  worktreePath: error.worktreePath,
  errorMessage: error.errorMessage,
  cleanupResult: error.cleanupResult,
});

const validationOperation = (operationName: string): string => {
  if (operationName === "create_disposable_workspace") return "create_snapshot_workspace";
  if (operationName === "cleanup_disposable_workspace") return "cleanup_snapshot_workspace";
  if (operationName === "disposable_workspace_interrupted") {
    return "snapshot_workspace_interrupted";
  }
  return operationName;
};

const toolingFailureResult = (toolingFailure: ValidationToolingFailure) =>
  Effect.succeed({ ok: false as const, toolingFailure });
