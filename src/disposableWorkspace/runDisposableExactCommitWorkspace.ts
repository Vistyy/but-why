import { lstatSync } from "node:fs";
import { join } from "node:path";

import { Effect, Ref, type Scope } from "effect";
import type { ReviewerProcessExecutor } from "../agent/reviewerExecution.js";
import {
  type WorkspaceCommandExecutor,
  WorkspaceCommandExecutionFailed,
} from "../command/workspaceCommand.js";
import type {
  DisposableWorkspace,
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceError,
  DisposableWorkspaceSetup,
} from "./disposableWorkspace.js";
import {
  deleteDisposableWorkspaceRef,
  ensureDisposableWorkspaceRef,
  inspectExistingWorktree,
  isDisposableWorktreeRemoved,
  removeDisposableWorktree,
} from "./disposableWorkspaceGit.js";
import { expectedDisposableWorkspacePath } from "./disposableWorkspacePath.js";
import { createWorkspaceRuntime } from "./workspaceRuntimeAdapter.js";

export type RunDisposableExactCommitWorkspaceInput<Error> = {
  readonly repoRoot: string;
  readonly workspaceRef: string;
  readonly commitSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceSetup?: (setup: DisposableWorkspaceSetup) => Effect.Effect<void, Error>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: DisposableWorkspaceError,
  ) => Effect.Effect<void>;
  readonly runInWorkspace?: (workspace: DisposableWorkspace) => Effect.Effect<void, Error>;
};

export type RunDisposableExactCommitWorkspaceResult =
  | {
      readonly ok: true;
      readonly setup: DisposableWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly toolingError: DisposableWorkspaceError;
    };

type DisposableExactCommitWorkspaceAdapters = {
  readonly createTempRef: (
    repoRoot: string,
    tempRefName: string,
    commitSha: string,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly deleteTempRef: (
    repoRoot: string,
    tempRefName: string,
  ) => DisposableWorkspaceCleanupResult["tempRef"];
  readonly allowlistedFileIsRegular: (repoRoot: string, path: string) => boolean;
  readonly inspectExistingWorktree: (worktreePath: string) => ExistingWorktree;
  readonly removeWorktree: (repoRoot: string, worktreePath: string) => CleanupAttempt;
  readonly verifyWorktreeRemoved: (repoRoot: string, worktreePath: string) => boolean;
  readonly createWorkspace: (input: {
    readonly repoRoot: string;
    readonly tempRefName: string;
    readonly copyFiles: readonly string[];
  }) => Effect.Effect<
    | {
        readonly ok: true;
        readonly workspace: WorkspaceAdapter;
        readonly worktreePath: string;
      }
    | {
        readonly ok: false;
        readonly message: string;
        readonly worktreePath?: string;
      }
  >;
  readonly readWorktreeHead: (
    workspace: WorkspaceAdapter,
  ) => Effect.Effect<CommandResult, WorkspaceCommandExecutionFailed>;
};

type WorkspaceAdapter = {
  readonly close: () => Promise<{ readonly preservedWorktreePath?: string }>;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly worktreePath: string;
};

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type CleanupAttempt = { readonly ok: true } | { readonly ok: false; readonly message: string };

type ExistingWorktree =
  | { readonly exists: false }
  | {
      readonly exists: true;
      readonly branch: string | undefined;
      readonly head: string | undefined;
      readonly dirty: boolean;
    };

type WorkspaceScopeState = {
  readonly tempRefName: string;
  readonly expectedWorktreePath: string;
  workspace: WorkspaceAdapter | undefined;
  worktreePath: string | undefined;
};

type WorkspaceSetupAttempt = WorkspaceSetupSuccess | WorkspaceSetupFailure;

type WorkspaceSetupSuccess = {
  readonly ok: true;
  readonly setup: Omit<DisposableWorkspaceSetup, "cleanupResult">;
};

type WorkspaceSetupFailure = {
  readonly ok: false;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly worktreePath?: string;
};

const cleanupStepTimeoutMs = 30_000;

const initialCleanupResult: DisposableWorkspaceCleanupResult = {
  worktree: "not_created",
  tempRef: "not_created",
};

export const runDisposableExactCommitWorkspace = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
): Effect.Effect<RunDisposableExactCommitWorkspaceResult, Error> =>
  runDisposableExactCommitWorkspaceWithAdapters(
    input,
    productionDisposableExactCommitWorkspaceAdapters,
  );

const runDisposableExactCommitWorkspaceWithAdapters = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  adapters: DisposableExactCommitWorkspaceAdapters,
): Effect.Effect<RunDisposableExactCommitWorkspaceResult, Error> =>
  Effect.gen(function* () {
    const tempRefName = input.workspaceRef;
    const expectedWorktreePath = expectedDisposableWorkspacePath(input.repoRoot, tempRefName);
    const cleanupResult = yield* Ref.make<DisposableWorkspaceCleanupResult>(initialCleanupResult);
    const state: WorkspaceScopeState = {
      tempRefName,
      expectedWorktreePath,
      workspace: undefined,
      worktreePath: undefined,
    };

    if (input.recordWorkspaceSetup !== undefined) {
      yield* input.recordWorkspaceSetup({
        workspaceRef: input.workspaceRef,
        tempRefName,
        commitSha: input.commitSha,
        worktreeHead: input.commitSha,
        worktreePath: expectedWorktreePath,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    const scopedSetup = Effect.scoped(
      setupDisposableWorkspaceScope(input, state, adapters, cleanupResult),
    );
    const setupAttempt = yield* withInterruptedCleanupRecording(
      scopedSetup,
      input,
      tempRefName,
      expectedWorktreePath,
      cleanupResult,
    );

    const finalCleanupResult = yield* Ref.get(cleanupResult);

    if (!setupAttempt.ok) {
      return {
        ok: false,
        toolingError: {
          operationName: setupAttempt.operationName,
          tempRefName,
          commitSha: input.commitSha,
          worktreePath: setupAttempt.worktreePath ?? expectedWorktreePath,
          errorMessage: setupAttempt.errorMessage,
          cleanupResult: finalCleanupResult,
        },
      };
    }

    if (finalCleanupResult.worktree === "failed" || finalCleanupResult.tempRef === "failed") {
      return {
        ok: false,
        toolingError: {
          operationName: "cleanup_disposable_workspace",
          tempRefName,
          commitSha: input.commitSha,
          ...(state.worktreePath === undefined ? {} : { worktreePath: state.worktreePath }),
          errorMessage: "Disposable workspace cleanup failed after successful use.",
          cleanupResult: finalCleanupResult,
        },
      };
    }

    return {
      ok: true,
      setup: {
        ...setupAttempt.setup,
        cleanupResult: finalCleanupResult,
      },
    };
  });

const withInterruptedCleanupRecording = <Error>(
  scopedSetup: Effect.Effect<WorkspaceSetupAttempt, Error>,
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  tempRefName: string,
  expectedWorktreePath: string,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<WorkspaceSetupAttempt, Error> => {
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;

  if (recordInterruptedCleanupResult === undefined) {
    return scopedSetup;
  }

  return Effect.onInterrupt(scopedSetup, () =>
    Effect.gen(function* () {
      const finalCleanupResult = yield* Ref.get(cleanupResult);
      yield* recordInterruptedCleanupResult({
        operationName: "disposable_workspace_interrupted",
        tempRefName,
        commitSha: input.commitSha,
        worktreePath: expectedWorktreePath,
        errorMessage: "Disposable workspace use was interrupted.",
        cleanupResult: finalCleanupResult,
      }).pipe(
        Effect.catchAllDefect(() => Effect.void),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.ignore,
      );
    }),
  );
};

const setupDisposableWorkspaceScope = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<WorkspaceSetupAttempt, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const tempRefAttempt = yield* acquireTempRef(input, state, adapters, cleanupResult);

    if (!tempRefAttempt.ok) {
      return tempRefAttempt;
    }

    const copyFileAttempt = validateAllowlistedCopyFiles(input, adapters);

    if (!copyFileAttempt.ok) {
      return copyFileAttempt;
    }

    const existingWorktreeAttempt = prepareExistingWorktree(input, state, adapters);

    if (!existingWorktreeAttempt.ok) {
      return existingWorktreeAttempt;
    }

    const worktreeAttempt = yield* acquireWorkspace(input, state, adapters, cleanupResult);

    if (!worktreeAttempt.ok) {
      return worktreeAttempt;
    }

    const verifiedWorkspace = yield* verifyWorktreeHead(
      input,
      state,
      adapters,
      worktreeAttempt.workspace,
    );

    if (!verifiedWorkspace.ok) {
      return verifiedWorkspace;
    }

    if (input.recordWorkspaceSetup !== undefined) {
      yield* input.recordWorkspaceSetup({
        ...verifiedWorkspace.setup,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    if (input.runInWorkspace !== undefined) {
      yield* input.runInWorkspace({
        commandExecutor: worktreeAttempt.workspace.commandExecutor,
        reviewerExecutor: worktreeAttempt.workspace.reviewerExecutor,
        worktreePath: state.worktreePath ?? state.expectedWorktreePath,
      });
    }

    return verifiedWorkspace;
  });

const acquireTempRef = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<{ readonly ok: true } | WorkspaceSetupFailure, never, Scope.Scope> =>
  Effect.gen(function* () {
    const tempRef = yield* adapters.createTempRef(
      input.repoRoot,
      state.tempRefName,
      input.commitSha,
    );

    if (!tempRef.ok) {
      return setupFailed("create_temp_ref", tempRef.message);
    }

    yield* Effect.acquireRelease(Effect.succeed(state.tempRefName), () =>
      releaseTempRef(input.repoRoot, state.tempRefName, adapters, cleanupResult),
    );

    return { ok: true };
  });

const validateAllowlistedCopyFiles = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  adapters: DisposableExactCommitWorkspaceAdapters,
): { readonly ok: true } | WorkspaceSetupFailure => {
  for (const path of input.copyFiles) {
    if (!adapters.allowlistedFileIsRegular(input.repoRoot, path)) {
      return setupFailed("copy_allowlisted_file", `Allowlisted workspace file is missing: ${path}`);
    }
  }

  return { ok: true };
};

const prepareExistingWorktree = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
): { readonly ok: true } | WorkspaceSetupFailure => {
  const existingWorktree = adapters.inspectExistingWorktree(state.expectedWorktreePath);

  if (!existingWorktree.exists) {
    return { ok: true };
  }

  if (
    existingWorktree.branch !== undefined &&
    existingWorktree.branch !== "HEAD" &&
    existingWorktree.branch !== state.tempRefName
  ) {
    return setupFailed(
      "create_disposable_workspace",
      `Disposable worktree already exists for a different workspace reference: ${state.expectedWorktreePath}`,
    );
  }

  if (existingWorktree.head !== input.commitSha) {
    return setupFailed(
      "create_disposable_workspace",
      `Disposable worktree already exists for a different commit: ${state.expectedWorktreePath}`,
    );
  }

  if (!existingWorktree.dirty) {
    return { ok: true };
  }

  state.worktreePath = state.expectedWorktreePath;
  const removed = adapters.removeWorktree(input.repoRoot, state.expectedWorktreePath);

  if (!removed.ok && !adapters.verifyWorktreeRemoved(input.repoRoot, state.expectedWorktreePath)) {
    return setupFailed(
      "create_disposable_workspace",
      `Disposable worktree already exists with uncommitted changes: ${state.expectedWorktreePath}`,
      state.expectedWorktreePath,
    );
  }

  state.worktreePath = undefined;
  return { ok: true };
};

const acquireWorkspace = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<
  { readonly ok: true; readonly workspace: WorkspaceAdapter } | WorkspaceSetupFailure,
  Error,
  Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.succeed(state.expectedWorktreePath), () =>
      releaseWorktree(input.repoRoot, state, adapters, cleanupResult),
    );

    state.worktreePath = state.expectedWorktreePath;
    const worktree = yield* adapters.createWorkspace({
      repoRoot: input.repoRoot,
      tempRefName: state.tempRefName,
      copyFiles: input.copyFiles,
    });

    if (!worktree.ok) {
      state.worktreePath = worktree.worktreePath ?? state.expectedWorktreePath;
      return setupFailed("create_disposable_workspace", worktree.message, state.worktreePath);
    }

    state.workspace = worktree.workspace;
    state.worktreePath = worktree.worktreePath;

    if (input.recordWorkspaceSetup !== undefined) {
      yield* input.recordWorkspaceSetup({
        workspaceRef: input.workspaceRef,
        tempRefName: state.tempRefName,
        commitSha: input.commitSha,
        worktreeHead: input.commitSha,
        worktreePath: worktree.worktreePath,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    return { ok: true, workspace: worktree.workspace };
  });

const verifyWorktreeHead = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  workspace: WorkspaceAdapter,
): Effect.Effect<WorkspaceSetupAttempt> =>
  Effect.gen(function* () {
    const headAttempt = yield* Effect.either(adapters.readWorktreeHead(workspace));
    if (headAttempt._tag === "Left") {
      return setupFailed(
        "create_disposable_workspace",
        headAttempt.left.message,
        state.worktreePath,
      );
    }
    const headResult = headAttempt.right;

    if (headResult.exitCode !== 0) {
      return setupFailed(
        "create_disposable_workspace",
        [headResult.stderr, headResult.stdout].join("\n").trim(),
        state.worktreePath,
      );
    }

    const worktreeHead = headResult.stdout.trim();

    if (worktreeHead !== input.commitSha) {
      return setupFailed(
        "create_disposable_workspace",
        `Disposable worktree HEAD ${worktreeHead} did not match requested commit ${input.commitSha}.`,
        state.worktreePath,
      );
    }

    return {
      ok: true,
      setup: {
        workspaceRef: input.workspaceRef,
        tempRefName: state.tempRefName,
        commitSha: input.commitSha,
        worktreeHead,
        worktreePath: state.worktreePath ?? state.expectedWorktreePath,
      },
    } satisfies WorkspaceSetupAttempt;
  });

const productionDisposableExactCommitWorkspaceAdapters: DisposableExactCommitWorkspaceAdapters = {
  createTempRef: (repoRoot, tempRefName, commitSha) =>
    Effect.sync(() => ensureDisposableWorkspaceRef(repoRoot, tempRefName, commitSha)),
  deleteTempRef: (repoRoot, tempRefName) => deleteDisposableWorkspaceRef(repoRoot, tempRefName),
  allowlistedFileIsRegular: (repoRoot, path) => {
    try {
      return lstatSync(join(repoRoot, path)).isFile();
    } catch {
      return false;
    }
  },
  inspectExistingWorktree,
  removeWorktree: (repoRoot, worktreePath) =>
    removeDisposableWorktree(repoRoot, worktreePath)
      ? { ok: true }
      : { ok: false, message: "Disposable worktree removal failed." },
  verifyWorktreeRemoved: isDisposableWorktreeRemoved,
  createWorkspace: (input) =>
    Effect.promise(async () => {
      try {
        const workspace = await createWorkspaceRuntime(input);
        return {
          ok: true,
          workspace,
          worktreePath: workspace.worktreePath,
        } as const;
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error),
          worktreePath: expectedDisposableWorkspacePath(input.repoRoot, input.tempRefName),
        } as const;
      }
    }),
  readWorktreeHead: (workspace) =>
    Effect.tryPromise({
      try: () => workspace.commandExecutor("git rev-parse HEAD"),
      catch: (error) =>
        error instanceof WorkspaceCommandExecutionFailed
          ? error
          : new WorkspaceCommandExecutionFailed({ message: errorMessage(error) }),
    }),
};

const setupFailed = (
  operationName: string,
  errorMessage: string,
  worktreePath?: string,
): WorkspaceSetupFailure => ({
  ok: false,
  operationName,
  errorMessage,
  ...(worktreePath === undefined ? {} : { worktreePath }),
});

const releaseWorktree = (
  repoRoot: string,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const worktree = yield* cleanupWorktree(repoRoot, state, adapters);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, worktree }));
  });

const cleanupWorktree = (
  repoRoot: string,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
): Effect.Effect<DisposableWorkspaceCleanupResult["worktree"]> => {
  if (state.workspace === undefined && state.worktreePath === undefined) {
    return Effect.succeed("not_created");
  }

  return Effect.gen(function* () {
    if (state.workspace !== undefined) {
      const workspace = state.workspace;
      const closeAttempt = yield* Effect.promise(() =>
        closeWorkspaceWithTimeout(workspace, cleanupStepTimeoutMs),
      );

      if (!closeAttempt.ok) return "failed";

      const cleanupPath = state.worktreePath ?? state.expectedWorktreePath;

      if (adapters.verifyWorktreeRemoved(repoRoot, cleanupPath)) return "removed";

      const removed = adapters.removeWorktree(repoRoot, cleanupPath);
      return removed.ok && adapters.verifyWorktreeRemoved(repoRoot, cleanupPath)
        ? "removed"
        : "failed";
    }

    if (
      state.worktreePath === undefined ||
      !adapters.inspectExistingWorktree(state.worktreePath).exists
    ) {
      return "not_created";
    }

    const removed = adapters.removeWorktree(repoRoot, state.worktreePath);
    return removed.ok && adapters.verifyWorktreeRemoved(repoRoot, state.worktreePath)
      ? "removed"
      : "failed";
  });
};

type WorkspaceCloseResult = { readonly preservedWorktreePath?: string };

type WorkspaceCloseAttempt =
  | { readonly ok: true; readonly result: WorkspaceCloseResult }
  | { readonly ok: false };

const closeWorkspaceWithTimeout = (
  workspace: WorkspaceAdapter,
  timeoutMs: number,
): Promise<WorkspaceCloseAttempt> =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve({ ok: false });
    }, timeoutMs);

    void workspace.close().then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: true, result });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false });
      },
    );
  });

const releaseTempRef = (
  repoRoot: string,
  tempRefName: string,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tempRef = adapters.deleteTempRef(repoRoot, tempRefName);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, tempRef }));
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
