import { Effect, Ref, type Scope } from "effect";
import { executeHostCommandEffect } from "../../command/hostCommand.js";
import {
  WorkspaceCommandExecutionFailed,
  type WorkspaceCommandExecutor,
} from "../../command/workspaceCommand.js";
import type {
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceOperationName,
} from "../disposableWorkspace.js";
import { expectedDisposableWorkspacePath } from "../disposableWorkspacePath.js";
import type {
  RunDisposableExactCommitWorkspaceInput,
  RunDisposableExactCommitWorkspaceResult,
} from "../runDisposableExactCommitWorkspace.js";
import {
  cleanupExactDisposableWorkspace,
  createDetachedDisposableWorktree,
  inspectDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "./disposableWorkspaceGit.js";

type SetupAttempt<WorkspaceResult> =
  | { readonly ok: true; readonly workspaceResult?: WorkspaceResult }
  | SetupFailure;

type SetupFailure = {
  readonly ok: false;
  readonly operationName: DisposableWorkspaceOperationName;
  readonly errorMessage: string;
};

const cleanupStepTimeoutMs = 30_000;
const initialCleanupResult: DisposableWorkspaceCleanupResult = { workspace: "not_created" };

export const runDisposableExactCommitWorkspace = <WorkspaceResult, Error>(
  input: RunDisposableExactCommitWorkspaceInput<WorkspaceResult, Error>,
): Effect.Effect<RunDisposableExactCommitWorkspaceResult<WorkspaceResult>, Error> =>
  Effect.gen(function* () {
    const worktreePath = expectedDisposableWorkspacePath(
      input.repositoryCommonDirectory,
      input.workspaceId,
    );
    const cleanupResult = yield* Ref.make<DisposableWorkspaceCleanupResult>(initialCleanupResult);

    const workspaceExit = yield* Effect.exit(
      withInterruptedCleanupRecording(
        Effect.scoped(runWorkspaceScope(input, worktreePath, cleanupResult)),
        input.recordWorkspaceCleanup,
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
    return attempt;
  });

const runWorkspaceScope = <WorkspaceResult, Error>(
  input: RunDisposableExactCommitWorkspaceInput<WorkspaceResult, Error>,
  worktreePath: string,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<SetupAttempt<WorkspaceResult>, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const parent = yield* prepareDisposableWorkspaceParent(
      input.repositoryRoot,
      input.repositoryCommonDirectory,
    );
    if (!parent.ok) return setupFailed("create_disposable_workspace", parent.message);

    yield* Effect.acquireRelease(Effect.succeed(worktreePath), () =>
      cleanupExactDisposableWorkspace(input.repositoryRoot, input.repositoryCommonDirectory, {
        workspaceId: input.workspaceId,
        expectedCommitSha: input.commitSha,
      }).pipe(
        Effect.flatMap((cleanup) => Ref.set(cleanupResult, cleanup)),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.flatMap((result) =>
          result._tag === "Some"
            ? Effect.void
            : Ref.set(cleanupResult, {
                workspace: "failed",
                errorMessage: "Snapshot Workspace cleanup timed out.",
              } satisfies DisposableWorkspaceCleanupResult),
        ),
      ),
    );

    const existing = yield* inspectDisposableWorktree(
      input.repositoryRoot,
      input.repositoryCommonDirectory,
      input.workspaceId,
      input.commitSha,
    );
    if (existing.state === "unproven") {
      return setupFailed("create_disposable_workspace", existing.message);
    }
    if (existing.state === "matching" && existing.dirty) {
      const removed = yield* cleanupExactDisposableWorkspace(
        input.repositoryRoot,
        input.repositoryCommonDirectory,
        {
          workspaceId: input.workspaceId,
          expectedCommitSha: input.commitSha,
        },
      );
      if (removed.workspace !== "removed") {
        return setupFailed(
          "create_disposable_workspace",
          removed.errorMessage ?? "Dirty Snapshot Workspace cleanup did not complete.",
        );
      }
    }
    if (existing.state === "absent" || (existing.state === "matching" && existing.dirty)) {
      const created = yield* createDetachedDisposableWorktree(
        input.repositoryRoot,
        worktreePath,
        input.commitSha,
      );
      if (!created.ok) return setupFailed("create_disposable_workspace", created.message);
    }

    const verified = yield* inspectDisposableWorktree(
      input.repositoryRoot,
      input.repositoryCommonDirectory,
      input.workspaceId,
      input.commitSha,
    );
    if (verified.state !== "matching") {
      return setupFailed(
        "create_disposable_workspace",
        verified.state === "unproven"
          ? verified.message
          : "Snapshot Workspace disappeared after acquisition.",
      );
    }

    if (input.runInWorkspace === undefined) return { ok: true } as const;
    const workspaceResult = yield* input.runInWorkspace({
      worktreePath,
      commandExecutor: workspaceCommandExecutor(worktreePath),
    });
    return { ok: true, workspaceResult } as const;
  });

const withInterruptedCleanupRecording = <WorkspaceResult, Error>(
  scoped: Effect.Effect<SetupAttempt<WorkspaceResult>, Error>,
  recordWorkspaceCleanup: RunDisposableExactCommitWorkspaceInput<
    WorkspaceResult,
    Error
  >["recordWorkspaceCleanup"],
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<SetupAttempt<WorkspaceResult>, Error> => {
  if (recordWorkspaceCleanup === undefined) return scoped;
  return Effect.onInterrupt(scoped, () =>
    Effect.gen(function* () {
      const cleanup = yield* Ref.get(cleanupResult);
      yield* recordWorkspaceCleanup(cleanup).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.catchAllDefect(() => Effect.void),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.ignore,
      );
    }),
  );
};

const workspaceCommandExecutor =
  (worktreePath: string): WorkspaceCommandExecutor =>
  (command, options) =>
    executeHostCommandEffect({
      command: "sh",
      args: ["-c", command],
      cwd: options?.cwd ?? worktreePath,
    }).pipe(
      Effect.mapError((error) => new WorkspaceCommandExecutionFailed({ message: error.message })),
    );

const setupFailed = (
  operationName: DisposableWorkspaceOperationName,
  errorMessage: string,
): SetupFailure => ({
  ok: false,
  operationName,
  errorMessage,
});
