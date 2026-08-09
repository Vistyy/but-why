import { lstatSync } from "node:fs";
import { join } from "node:path";

import { createSandbox, type Sandbox, type SandboxProvider } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { Effect, Ref, type Scope } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import {
  type CleanupState,
  deleteDisposableTempRef,
  disposableWorktreePath,
  ensureDisposableTempRef,
  inspectDisposableWorktree,
  isDisposableWorktreeRemoved,
  removeDisposableWorktree,
} from "./workspaceGit.js";

export type DisposableWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ActiveDisposableWorkspace = {
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly worktreePath: string;
};

export type DisposableWorkspaceSetup = {
  readonly runId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly worktreePath?: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};

export type DisposableWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};

export type CreateDisposableWorkspaceInput<R, E> = {
  readonly repoRoot: string;
  readonly runId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly recordWorkspaceSetup?: (
    setup: DisposableWorkspaceSetup,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly recordInterruptedCleanupResult?: (
    toolingError: DisposableWorkspaceToolingError,
  ) => Effect.Effect<void, unknown>;
  readonly runInWorkspace?: (
    workspace: ActiveDisposableWorkspace,
  ) => Effect.Effect<R, E | RepositoryStorageError>;
};

export type CreateDisposableWorkspaceResult<R> =
  | {
      readonly ok: true;
      readonly setup: DisposableWorkspaceSetup;
      readonly activeWorkspaceResult?: R;
    }
  | {
      readonly ok: false;
      readonly toolingError: DisposableWorkspaceToolingError;
    };

type WorkspaceAdapters = {
  readonly createTempRef: (
    repoRoot: string,
    tempRefName: string,
    submittedSha: string,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly deleteTempRef: (
    repoRoot: string,
    tempRefName: string,
  ) => DisposableWorkspaceCleanupResult["tempRef"];
  readonly allowlistedFileIsRegular: (repoRoot: string, path: string) => boolean;
  readonly inspectExistingWorktree: (worktreePath: string) => ExistingWorktree;
  readonly removeWorktree: (repoRoot: string, worktreePath: string) => CleanupAttempt;
  readonly verifyWorktreeRemoved: (repoRoot: string, worktreePath: string) => boolean;
  readonly createSandcastleWorktree: (input: {
    readonly repoRoot: string;
    readonly tempRefName: string;
    readonly copyFiles: readonly string[];
    readonly sandboxProvider: SandboxProvider;
  }) => Effect.Effect<
    | {
        readonly ok: true;
        readonly sandbox: SandboxLike;
        readonly worktreePath: string;
      }
    | {
        readonly ok: false;
        readonly message: string;
        readonly worktreePath?: string;
      }
  >;
  readonly readWorktreeHead: (sandbox: SandboxLike) => Effect.Effect<CommandResult>;
};

type SandboxLike = Pick<Sandbox, "close" | "exec" | "run" | "worktreePath">;

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
  sandbox: SandboxLike | undefined;
  worktreePath: string | undefined;
};

type WorkspaceSetupAttempt<R> = WorkspaceSetupSuccess<R> | WorkspaceSetupFailure;

type WorkspaceSetupSuccess<R> = {
  readonly ok: true;
  readonly setup: Omit<DisposableWorkspaceSetup, "cleanupResult">;
  readonly activeWorkspaceResult?: R;
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

export const createDisposableWorkspace = <R, E>(
  input: CreateDisposableWorkspaceInput<R, E>,
): Effect.Effect<CreateDisposableWorkspaceResult<R>, E | RepositoryStorageError> =>
  createDisposableWorkspaceWithAdapters(input, productionWorkspaceAdapters);

const createDisposableWorkspaceWithAdapters = <R, E>(
  input: CreateDisposableWorkspaceInput<R, E>,
  adapters: WorkspaceAdapters,
): Effect.Effect<CreateDisposableWorkspaceResult<R>, E | RepositoryStorageError> =>
  Effect.gen(function* () {
    const expectedWorktreePath = disposableWorktreePath(input.repoRoot, input.tempRefName);
    const cleanupResult = yield* Ref.make<DisposableWorkspaceCleanupResult>(initialCleanupResult);
    const state: WorkspaceScopeState = {
      tempRefName: input.tempRefName,
      expectedWorktreePath,
      sandbox: undefined,
      worktreePath: undefined,
    };

    if (input.recordWorkspaceSetup !== undefined) {
      yield* input.recordWorkspaceSetup({
        runId: input.runId,
        tempRefName: input.tempRefName,
        submittedSha: input.submittedSha,
        worktreeHead: input.submittedSha,
        worktreePath: expectedWorktreePath,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    const scopedSetup = Effect.scoped(setupWorkspaceScope(input, state, adapters, cleanupResult));
    const setupAttempt = yield* withInterruptedCleanupRecording(
      scopedSetup,
      input,
      expectedWorktreePath,
      cleanupResult,
    );

    const finalCleanupResult = yield* Ref.get(cleanupResult);

    if (!setupAttempt.ok) {
      return {
        ok: false,
        toolingError: {
          operationName: setupAttempt.operationName,
          tempRefName: input.tempRefName,
          submittedSha: input.submittedSha,
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
          tempRefName: input.tempRefName,
          submittedSha: input.submittedSha,
          ...(state.worktreePath === undefined ? {} : { worktreePath: state.worktreePath }),
          errorMessage: "Disposable workspace cleanup failed after successful setup.",
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
      ...(setupAttempt.activeWorkspaceResult === undefined
        ? {}
        : { activeWorkspaceResult: setupAttempt.activeWorkspaceResult }),
    };
  });

const withInterruptedCleanupRecording = <R, E>(
  scopedSetup: Effect.Effect<WorkspaceSetupAttempt<R>, E | RepositoryStorageError>,
  input: CreateDisposableWorkspaceInput<R, E>,
  expectedWorktreePath: string,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<WorkspaceSetupAttempt<R>, E | RepositoryStorageError> => {
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;

  if (recordInterruptedCleanupResult === undefined) {
    return scopedSetup;
  }

  return Effect.onInterrupt(scopedSetup, () =>
    Effect.gen(function* () {
      const finalCleanupResult = yield* Ref.get(cleanupResult);
      yield* recordInterruptedCleanupResult({
        operationName: "disposable_workspace_interrupted",
        tempRefName: input.tempRefName,
        submittedSha: input.submittedSha,
        worktreePath: expectedWorktreePath,
        errorMessage: "Disposable workspace setup was interrupted.",
        cleanupResult: finalCleanupResult,
      }).pipe(
        Effect.catchAllDefect(() => Effect.void),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.ignore,
      );
    }),
  );
};

const setupWorkspaceScope = <R, E>(
  input: CreateDisposableWorkspaceInput<R, E>,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<WorkspaceSetupAttempt<R>, E | RepositoryStorageError, Scope.Scope> =>
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

    const worktreeAttempt = yield* acquireSandcastleWorktree(input, state, adapters, cleanupResult);

    if (!worktreeAttempt.ok) {
      return worktreeAttempt;
    }

    const verifiedWorkspace = yield* verifyWorktreeHead<R>(
      input,
      state,
      adapters,
      worktreeAttempt.sandbox,
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

    const activeWorkspaceResult =
      input.runInWorkspace === undefined
        ? undefined
        : yield* input.runInWorkspace({
            sandbox: worktreeAttempt.sandbox,
            worktreePath: state.worktreePath ?? state.expectedWorktreePath,
          });

    return {
      ...verifiedWorkspace,
      ...(activeWorkspaceResult === undefined ? {} : { activeWorkspaceResult }),
    };
  });

const acquireTempRef = (
  input: CreateDisposableWorkspaceInput<unknown, unknown>,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<{ readonly ok: true } | WorkspaceSetupFailure, never, Scope.Scope> =>
  Effect.gen(function* () {
    const tempRef = yield* adapters.createTempRef(
      input.repoRoot,
      state.tempRefName,
      input.submittedSha,
    );

    if (!tempRef.ok) {
      return setupFailed("create_temp_ref", tempRef.message);
    }

    yield* Effect.acquireRelease(Effect.succeed(state.tempRefName), () =>
      releaseTempRef(input.repoRoot, state.tempRefName, adapters, cleanupResult),
    );

    return { ok: true };
  });

const validateAllowlistedCopyFiles = (
  input: CreateDisposableWorkspaceInput<unknown, unknown>,
  adapters: WorkspaceAdapters,
): { readonly ok: true } | WorkspaceSetupFailure => {
  for (const path of input.copyFiles) {
    if (!adapters.allowlistedFileIsRegular(input.repoRoot, path)) {
      return setupFailed(
        "copy_allowlisted_file",
        `Allowlisted disposable workspace file is missing: ${path}`,
      );
    }
  }

  return { ok: true };
};

const prepareExistingWorktree = (
  input: CreateDisposableWorkspaceInput<unknown, unknown>,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
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
      "create_sandcastle_workspace",
      `Disposable workspace already exists for a different run: ${state.expectedWorktreePath}`,
    );
  }

  if (existingWorktree.head !== input.submittedSha) {
    return setupFailed(
      "create_sandcastle_workspace",
      `Disposable workspace already exists for a different commit: ${state.expectedWorktreePath}`,
    );
  }

  if (!existingWorktree.dirty) {
    return { ok: true };
  }

  state.worktreePath = state.expectedWorktreePath;
  const removed = adapters.removeWorktree(input.repoRoot, state.expectedWorktreePath);

  if (!removed.ok && !adapters.verifyWorktreeRemoved(input.repoRoot, state.expectedWorktreePath)) {
    return setupFailed(
      "create_sandcastle_workspace",
      `Disposable workspace already exists with uncommitted changes: ${state.expectedWorktreePath}`,
      state.expectedWorktreePath,
    );
  }

  state.worktreePath = undefined;
  return { ok: true };
};

const acquireSandcastleWorktree = (
  input: CreateDisposableWorkspaceInput<unknown, unknown>,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<
  { readonly ok: true; readonly sandbox: SandboxLike } | WorkspaceSetupFailure,
  RepositoryStorageError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.succeed(state.expectedWorktreePath), () =>
      releaseWorktree(input.repoRoot, state, adapters, cleanupResult),
    );

    state.worktreePath = state.expectedWorktreePath;
    const worktree = yield* adapters.createSandcastleWorktree({
      repoRoot: input.repoRoot,
      tempRefName: state.tempRefName,
      copyFiles: input.copyFiles,
      sandboxProvider: noSandbox(),
    });

    if (!worktree.ok) {
      state.worktreePath = worktree.worktreePath ?? state.expectedWorktreePath;
      return setupFailed("create_sandcastle_workspace", worktree.message, state.worktreePath);
    }

    state.sandbox = worktree.sandbox;
    state.worktreePath = worktree.worktreePath;

    if (input.recordWorkspaceSetup !== undefined) {
      yield* input.recordWorkspaceSetup({
        runId: input.runId,
        tempRefName: state.tempRefName,
        submittedSha: input.submittedSha,
        worktreeHead: input.submittedSha,
        worktreePath: worktree.worktreePath,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    return { ok: true, sandbox: worktree.sandbox };
  });

const verifyWorktreeHead = <R>(
  input: CreateDisposableWorkspaceInput<R, unknown>,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
  sandbox: SandboxLike,
): Effect.Effect<WorkspaceSetupAttempt<R>> =>
  Effect.gen(function* () {
    const headResult = yield* adapters.readWorktreeHead(sandbox);

    if (headResult.exitCode !== 0) {
      return setupFailed(
        "create_sandcastle_workspace",
        [headResult.stderr, headResult.stdout].join("\n").trim(),
        state.worktreePath,
      );
    }

    const worktreeHead = headResult.stdout.trim();

    if (worktreeHead !== input.submittedSha) {
      return setupFailed(
        "create_sandcastle_workspace",
        `Disposable workspace HEAD ${worktreeHead} did not match submitted SHA ${input.submittedSha}.`,
        state.worktreePath,
      );
    }

    return {
      ok: true,
      setup: {
        runId: input.runId,
        tempRefName: state.tempRefName,
        submittedSha: input.submittedSha,
        worktreeHead,
        worktreePath: state.worktreePath ?? state.expectedWorktreePath,
      },
    } satisfies WorkspaceSetupAttempt<R>;
  });

const productionWorkspaceAdapters: WorkspaceAdapters = {
  createTempRef: (repoRoot, tempRefName, submittedSha) =>
    Effect.sync(() => ensureDisposableTempRef(repoRoot, tempRefName, submittedSha)),
  deleteTempRef: (repoRoot, tempRefName) => deleteDisposableTempRef(repoRoot, tempRefName),
  allowlistedFileIsRegular: (repoRoot, path) => {
    try {
      return lstatSync(join(repoRoot, path)).isFile();
    } catch {
      return false;
    }
  },
  inspectExistingWorktree: inspectDisposableWorktree,
  removeWorktree: (repoRoot, worktreePath) =>
    removeDisposableWorktree(repoRoot, worktreePath)
      ? { ok: true }
      : { ok: false, message: "Disposable workspace removal failed." },
  verifyWorktreeRemoved: isDisposableWorktreeRemoved,
  createSandcastleWorktree: (input) =>
    Effect.promise(async () => {
      try {
        const sandbox = await createSandbox({
          cwd: input.repoRoot,
          branch: input.tempRefName,
          sandbox: input.sandboxProvider,
          copyToWorktree: [...input.copyFiles],
        });

        return {
          ok: true,
          sandbox,
          worktreePath: sandbox.worktreePath,
        } as const;
      } catch (error) {
        return {
          ok: false,
          message: errorMessage(error),
          worktreePath: disposableWorktreePath(input.repoRoot, input.tempRefName),
        } as const;
      }
    }),
  readWorktreeHead: (sandbox) => Effect.promise(() => sandbox.exec("git rev-parse HEAD")),
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
  adapters: WorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const worktree = yield* cleanupWorktree(repoRoot, state, adapters);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, worktree }));
  });

const cleanupWorktree = (
  repoRoot: string,
  state: WorkspaceScopeState,
  adapters: WorkspaceAdapters,
): Effect.Effect<DisposableWorkspaceCleanupResult["worktree"]> => {
  if (state.sandbox === undefined && state.worktreePath === undefined) {
    return Effect.succeed("not_created");
  }

  return Effect.gen(function* () {
    if (state.sandbox !== undefined) {
      const sandbox = state.sandbox;
      const closeAttempt = yield* Effect.promise(() =>
        closeSandboxWithTimeout(sandbox, cleanupStepTimeoutMs),
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

type SandcastleCloseResult = { readonly preservedWorktreePath?: string };

type SandcastleCloseAttempt =
  | { readonly ok: true; readonly result: SandcastleCloseResult }
  | { readonly ok: false };

const closeSandboxWithTimeout = (
  sandbox: SandboxLike,
  timeoutMs: number,
): Promise<SandcastleCloseAttempt> =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve({ ok: false });
    }, timeoutMs);

    void sandbox.close().then(
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
  adapters: WorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tempRef = adapters.deleteTempRef(repoRoot, tempRefName);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, tempRef }));
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
