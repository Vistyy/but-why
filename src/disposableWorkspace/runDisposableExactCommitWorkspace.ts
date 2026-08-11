import type { Effect } from "effect";

import type {
  DisposableWorkspace,
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceError,
} from "./disposableWorkspace.js";

export type RunDisposableExactCommitWorkspaceInput<WorkspaceResult, Error> = {
  readonly repoRoot: string;
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceCleanup?: (
    cleanupResult: DisposableWorkspaceCleanupResult,
  ) => Effect.Effect<void, Error>;
  readonly runInWorkspace?: (
    workspace: DisposableWorkspace,
  ) => Effect.Effect<WorkspaceResult, Error>;
};

export type RunDisposableExactCommitWorkspaceResult<WorkspaceResult> =
  | { readonly ok: true; readonly workspaceResult?: WorkspaceResult }
  | { readonly ok: false; readonly toolingError: DisposableWorkspaceError };

export type RunDisposableExactCommitWorkspace = <WorkspaceResult, Error>(
  input: RunDisposableExactCommitWorkspaceInput<WorkspaceResult, Error>,
) => Effect.Effect<RunDisposableExactCommitWorkspaceResult<WorkspaceResult>, Error>;
