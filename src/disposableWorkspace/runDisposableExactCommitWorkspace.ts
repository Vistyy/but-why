import { Effect, Ref, type Scope } from "effect";
import { executeHostCommand, type HostCommandResult } from "../command/hostCommand.js";
import {
  WorkspaceCommandExecutionFailed,
  type WorkspaceCommandExecutor,
} from "../command/workspaceCommand.js";
import type {
  DisposableWorkspace,
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceError,
  DisposableWorkspaceOperationName,
} from "./disposableWorkspace.js";
import {
  cleanupExactDisposableWorkspace,
  copyDisposableWorkspaceFiles,
  createDetachedDisposableWorktree,
  inspectDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "./disposableWorkspaceGit.js";
import { expectedDisposableWorkspacePath } from "./disposableWorkspacePath.js";

export type RunDisposableExactCommitWorkspaceInput<Error> = {
  readonly repoRoot: string;
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceCleanup?: (
    cleanupResult: DisposableWorkspaceCleanupResult,
  ) => Effect.Effect<void, Error>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: DisposableWorkspaceError,
  ) => Effect.Effect<void>;
  readonly runInWorkspace?: (workspace: DisposableWorkspace) => Effect.Effect<void, Error>;
};

export type RunDisposableExactCommitWorkspaceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly toolingError: DisposableWorkspaceError };

export type RunDisposableExactCommitWorkspace = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
) => Effect.Effect<RunDisposableExactCommitWorkspaceResult, Error>;

type SetupAttempt =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly operationName: DisposableWorkspaceOperationName;
      readonly errorMessage: string;
    };

const cleanupStepTimeoutMs = 30_000;
const initialCleanupResult: DisposableWorkspaceCleanupResult = { workspace: "not_created" };

export const runDisposableExactCommitWorkspace = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
): Effect.Effect<RunDisposableExactCommitWorkspaceResult, Error> =>
  Effect.gen(function* () {
    const worktreePath = expectedDisposableWorkspacePath(input.repoRoot, input.workspaceId);
    const cleanupResult = yield* Ref.make<DisposableWorkspaceCleanupResult>(initialCleanupResult);

    const workspaceExit = yield* Effect.exit(
      withInterruptedCleanupRecording(
        Effect.scoped(runWorkspaceScope(input, worktreePath, cleanupResult)),
        input,
        worktreePath,
        cleanupResult,
      ),
    );
    const finalCleanupResult = yield* Ref.get(cleanupResult);
    if (input.recordWorkspaceCleanup !== undefined) {
      yield* Effect.uninterruptible(input.recordWorkspaceCleanup(finalCleanupResult));
    }
    if (workspaceExit._tag === "Failure") return yield* Effect.failCause(workspaceExit.cause);
    const attempt = workspaceExit.value;

    if (!attempt.ok) {
      return {
        ok: false,
        toolingError: {
          operationName: attempt.operationName,
          workspaceId: input.workspaceId,
          commitSha: input.commitSha,
          worktreePath,
          errorMessage: attempt.errorMessage,
          cleanupResult: finalCleanupResult,
        },
      };
    }
    if (finalCleanupResult.workspace === "failed") {
      return {
        ok: false,
        toolingError: {
          operationName: "cleanup_disposable_workspace",
          workspaceId: input.workspaceId,
          commitSha: input.commitSha,
          worktreePath,
          errorMessage: "Snapshot Workspace cleanup failed after successful use.",
          cleanupResult: finalCleanupResult,
        },
      };
    }
    return { ok: true };
  });

const runWorkspaceScope = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  worktreePath: string,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<SetupAttempt, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const parent = yield* prepareDisposableWorkspaceParent(input.repoRoot);
    if (!parent.ok) return setupFailed("create_disposable_workspace", parent.message);

    yield* Effect.acquireRelease(Effect.succeed(worktreePath), () =>
      cleanupExactDisposableWorkspace(input.repoRoot, {
        workspaceId: input.workspaceId,
        expectedCommitSha: input.commitSha,
        recordedWorktreePath: worktreePath,
      }).pipe(
        Effect.flatMap((cleanup) =>
          Ref.set(cleanupResult, {
            workspace: cleanup.workspace,
          } satisfies DisposableWorkspaceCleanupResult),
        ),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.flatMap((result) =>
          result._tag === "Some"
            ? Effect.void
            : Ref.set(cleanupResult, {
                workspace: "failed",
              } satisfies DisposableWorkspaceCleanupResult),
        ),
      ),
    );

    const existing = yield* inspectDisposableWorktree(
      input.repoRoot,
      input.workspaceId,
      input.commitSha,
      worktreePath,
    );
    if (existing.state === "unproven") {
      return setupFailed("create_disposable_workspace", existing.message);
    }
    if (existing.state === "matching" && existing.dirty) {
      const removed = yield* cleanupExactDisposableWorkspace(input.repoRoot, {
        workspaceId: input.workspaceId,
        expectedCommitSha: input.commitSha,
        recordedWorktreePath: worktreePath,
      });
      if (removed.workspace !== "removed") {
        return setupFailed(
          "create_disposable_workspace",
          removed.errorMessage ?? "Dirty Snapshot Workspace cleanup did not complete.",
        );
      }
    }
    if (existing.state === "absent" || (existing.state === "matching" && existing.dirty)) {
      const created = yield* createDetachedDisposableWorktree(
        input.repoRoot,
        worktreePath,
        input.commitSha,
      );
      if (!created.ok) return setupFailed("create_disposable_workspace", created.message);
    }

    const verified = yield* inspectDisposableWorktree(
      input.repoRoot,
      input.workspaceId,
      input.commitSha,
      worktreePath,
    );
    if (verified.state !== "matching") {
      return setupFailed(
        "create_disposable_workspace",
        verified.state === "unproven"
          ? verified.message
          : "Snapshot Workspace disappeared after acquisition.",
      );
    }

    const copied = yield* copyDisposableWorkspaceFiles(
      input.repoRoot,
      worktreePath,
      input.copyFiles,
    );
    if (!copied.ok) return setupFailed("copy_allowlisted_file", copied.message);

    if (input.runInWorkspace !== undefined) {
      yield* input.runInWorkspace({
        worktreePath,
        commandExecutor: workspaceCommandExecutor(worktreePath),
      });
    }
    return { ok: true } as const;
  });

const withInterruptedCleanupRecording = <Error>(
  scoped: Effect.Effect<SetupAttempt, Error>,
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  worktreePath: string,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<SetupAttempt, Error> => {
  if (input.recordInterruptedCleanupResult === undefined) return scoped;
  return Effect.onInterrupt(scoped, () =>
    Effect.gen(function* () {
      const cleanup = yield* Ref.get(cleanupResult);
      yield* input
        .recordInterruptedCleanupResult?.({
          operationName: "disposable_workspace_interrupted",
          workspaceId: input.workspaceId,
          commitSha: input.commitSha,
          worktreePath,
          errorMessage: "Snapshot Workspace use was interrupted.",
          cleanupResult: cleanup,
        })
        .pipe(
          Effect.catchAllDefect(() => Effect.void),
          Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
          Effect.ignore,
        ) ?? Effect.void;
    }),
  );
};

const workspaceCommandExecutor =
  (worktreePath: string): WorkspaceCommandExecutor =>
  async (command, options) => {
    try {
      const result: HostCommandResult = await executeHostCommand({
        command: "sh",
        args: ["-c", command],
        cwd: options?.cwd ?? worktreePath,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      return result;
    } catch (error) {
      throw new WorkspaceCommandExecutionFailed({ message: errorMessage(error) });
    }
  };

const setupFailed = (
  operationName: DisposableWorkspaceOperationName,
  errorMessage: string,
): SetupAttempt => ({
  ok: false,
  operationName,
  errorMessage,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
