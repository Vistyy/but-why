import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  RunDisposableExactCommitWorkspace,
  RunDisposableExactCommitWorkspaceInput,
} from "../../disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import type {
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceError,
  DisposableWorkspaceOperationName,
} from "../../disposableWorkspace/disposableWorkspace.js";
import type {
  ActiveSnapshotWorkspace,
  ActiveSnapshotWorkspaceResult,
  SnapshotWorkspaceCleanupResult,
  SnapshotWorkspaceOperationName,
  SnapshotWorkspaceToolingError,
} from "./snapshotWorkspace.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";

export type CreateSnapshotWorkspaceInput = {
  readonly repoRoot: string;
  readonly validationRunId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceCleanup?: (
    cleanupResult: SnapshotWorkspaceCleanupResult,
  ) => Effect.Effect<void, RepositoryStorageError>;
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
      readonly activeWorkspaceResult?: ActiveSnapshotWorkspaceResult;
    }
  | { readonly ok: false; readonly toolingError: SnapshotWorkspaceToolingError }
  | {
      readonly ok: false;
      readonly toolingFailure: ValidationToolingFailure;
      readonly cleanupResult: DisposableWorkspaceCleanupResult;
    };

export type CreateSnapshotWorkspace = (
  input: CreateSnapshotWorkspaceInput,
) => Effect.Effect<CreateSnapshotWorkspaceResult, RepositoryStorageError>;

export const makeCreateSnapshotWorkspace =
  (runDisposableExactCommitWorkspace: RunDisposableExactCommitWorkspace): CreateSnapshotWorkspace =>
  (input) => {
    let cleanupResult: DisposableWorkspaceCleanupResult = { workspace: "not_created" };
    const observeCleanup = (result: DisposableWorkspaceCleanupResult): void => {
      cleanupResult = result;
    };
    const failure = (toolingFailure: ValidationToolingFailure) =>
      toolingFailureResult(toolingFailure, cleanupResult);
    return createSnapshotWorkspaceAdapter(
      input,
      observeCleanup,
      runDisposableExactCommitWorkspace,
    ).pipe(
      Effect.catchTags({
        SnapshotWorkspaceSetupFailed: failure,
        InfrastructureToolingFailed: failure,
        GitToolingFailed: failure,
        ReviewerProcessToolingFailed: failure,
        PrepareCommandExecutionToolingFailed: failure,
        CheckCommandExecutionToolingFailed: failure,
        ReviewerOutputContractFailed: failure,
        TokenUsageContractFailed: failure,
      }),
    );
  };

const createSnapshotWorkspaceAdapter = (
  input: CreateSnapshotWorkspaceInput,
  observeCleanup: (cleanupResult: DisposableWorkspaceCleanupResult) => void,
  runDisposableExactCommitWorkspace: RunDisposableExactCommitWorkspace,
): Effect.Effect<
  CreateSnapshotWorkspaceResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    const workspaceInput: RunDisposableExactCommitWorkspaceInput<
      ActiveSnapshotWorkspaceResult,
      ValidationToolingFailure | RepositoryStorageError
    > = {
      repoRoot: input.repoRoot,
      workspaceId: input.validationRunId,
      commitSha: input.submittedSha,
      copyFiles: input.copyFiles,
      recordWorkspaceCleanup: (cleanupResult) =>
        Effect.sync(() => observeCleanup(cleanupResult)).pipe(
          Effect.zipRight(input.recordWorkspaceCleanup?.(cleanupResult) ?? Effect.void),
        ),
      ...(input.runInWorkspace === undefined ? {} : { runInWorkspace: input.runInWorkspace }),
    };
    const result = yield* runDisposableExactCommitWorkspace(workspaceInput);
    if (!result.ok) return { ok: false, toolingError: validationError(result.toolingError) };
    return {
      ok: true,
      ...(result.workspaceResult === undefined
        ? {}
        : { activeWorkspaceResult: result.workspaceResult }),
    };
  });

const validationError = (error: DisposableWorkspaceError): SnapshotWorkspaceToolingError => ({
  operationName: snapshotWorkspaceOperation(error.operationName),
  validationRunId: error.workspaceId,
  expectedCommitSha: error.commitSha,
  worktreePath: error.worktreePath,
  errorMessage: error.errorMessage,
  cleanupResult: error.cleanupResult,
});

const snapshotWorkspaceOperation = (
  operationName: DisposableWorkspaceOperationName,
): SnapshotWorkspaceOperationName => {
  switch (operationName) {
    case "create_disposable_workspace":
      return "create_snapshot_workspace";
    case "cleanup_disposable_workspace":
      return "cleanup_snapshot_workspace";
    case "copy_allowlisted_file":
      return "copy_allowlisted_file";
  }
};

const toolingFailureResult = (
  toolingFailure: ValidationToolingFailure,
  cleanupResult: DisposableWorkspaceCleanupResult,
) => Effect.succeed({ ok: false as const, toolingFailure, cleanupResult });
