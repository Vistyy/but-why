import { lstatSync } from "node:fs";
import { join } from "node:path";

import { createSandbox, type Sandbox, type SandboxProvider } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { Effect, Ref, type Scope } from "effect";
import type {
  DisposableWorkspace,
  DisposableWorkspaceCleanupResult,
  DisposableWorkspaceError,
  DisposableWorkspaceSetup,
} from "./disposableWorkspace.js";
import {
  deleteDisposableWorkspaceRefWithDiagnostic,
  ensureDisposableWorkspaceRef,
  inspectExistingWorktree,
  isDisposableWorktreeRemoved,
  removeDisposableWorktreeWithDiagnostic,
} from "./disposableWorkspaceGit.js";
import { expectedDisposableWorkspacePath } from "./disposableWorkspacePath.js";

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
  readonly deleteTempRef: (repoRoot: string, tempRefName: string) => CleanupAttempt;
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

type CleanupStepResult =
  | { readonly state: "not_created" | "removed" }
  | { readonly state: "failed"; readonly diagnostic: string };

type CleanupDiagnostics = {
  readonly worktree?: string;
  readonly tempRef?: string;
};

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
    const cleanupDiagnostics = yield* Ref.make<CleanupDiagnostics>({});
    const state: WorkspaceScopeState = {
      tempRefName,
      expectedWorktreePath,
      sandbox: undefined,
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
      setupDisposableWorkspaceScope(input, state, adapters, cleanupResult, cleanupDiagnostics),
    );
    const setupAttempt = yield* withInterruptedCleanupRecording(
      scopedSetup,
      input,
      tempRefName,
      expectedWorktreePath,
      cleanupResult,
      cleanupDiagnostics,
    );

    const finalCleanupResult = yield* Ref.get(cleanupResult);
    const finalCleanupDiagnostics = yield* Ref.get(cleanupDiagnostics);

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
          ...(Object.keys(finalCleanupDiagnostics).length === 0
            ? {}
            : { cleanupDiagnostics: finalCleanupDiagnostics }),
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
          ...(Object.keys(finalCleanupDiagnostics).length === 0
            ? {}
            : { cleanupDiagnostics: finalCleanupDiagnostics }),
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
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<WorkspaceSetupAttempt, Error> => {
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;

  if (recordInterruptedCleanupResult === undefined) {
    return scopedSetup;
  }

  return Effect.onInterrupt(scopedSetup, () =>
    Effect.gen(function* () {
      const finalCleanupResult = yield* Ref.get(cleanupResult);
      const finalCleanupDiagnostics = yield* Ref.get(cleanupDiagnostics);
      yield* recordInterruptedCleanupResult({
        operationName: "disposable_workspace_interrupted",
        tempRefName,
        commitSha: input.commitSha,
        worktreePath: expectedWorktreePath,
        errorMessage: "Disposable workspace use was interrupted.",
        cleanupResult: finalCleanupResult,
        ...(Object.keys(finalCleanupDiagnostics).length === 0
          ? {}
          : { cleanupDiagnostics: finalCleanupDiagnostics }),
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
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<WorkspaceSetupAttempt, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const tempRefAttempt = yield* acquireTempRef(
      input,
      state,
      adapters,
      cleanupResult,
      cleanupDiagnostics,
    );

    if (!tempRefAttempt.ok) {
      return tempRefAttempt;
    }

    const copyFileAttempt = validateAllowlistedCopyFiles(input, adapters);

    if (!copyFileAttempt.ok) {
      return copyFileAttempt;
    }

    const existingWorktreeAttempt = yield* prepareExistingWorktree(
      input,
      state,
      adapters,
      cleanupResult,
      cleanupDiagnostics,
    );

    if (!existingWorktreeAttempt.ok) {
      return existingWorktreeAttempt;
    }

    const worktreeAttempt = yield* acquireSandcastleWorktree(
      input,
      state,
      adapters,
      cleanupResult,
      cleanupDiagnostics,
    );

    if (!worktreeAttempt.ok) {
      return worktreeAttempt;
    }

    const verifiedWorkspace = yield* verifyWorktreeHead(
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

    if (input.runInWorkspace !== undefined) {
      yield* input.runInWorkspace({
        sandbox: worktreeAttempt.sandbox,
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
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
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
      releaseTempRef(
        input.repoRoot,
        state.tempRefName,
        adapters,
        cleanupResult,
        cleanupDiagnostics,
      ),
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
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<{ readonly ok: true } | WorkspaceSetupFailure> =>
  Effect.gen(function* () {
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
        `Disposable worktree already exists for a different workspace reference: ${state.expectedWorktreePath}`,
      );
    }

    if (existingWorktree.head !== input.commitSha) {
      return setupFailed(
        "create_sandcastle_workspace",
        `Disposable worktree already exists for a different commit: ${state.expectedWorktreePath}`,
      );
    }

    if (!existingWorktree.dirty) {
      return { ok: true };
    }

    state.worktreePath = state.expectedWorktreePath;
    const removed = adapters.removeWorktree(input.repoRoot, state.expectedWorktreePath);

    if (!removed.ok && !adapters.verifyWorktreeRemoved(input.repoRoot, state.expectedWorktreePath)) {
      yield* Ref.update(cleanupResult, (current) => ({ ...current, worktree: "failed" as const }));
      yield* Ref.update(cleanupDiagnostics, (current) => ({
        ...current,
        worktree: removed.message,
      }));
      return setupFailed(
        "create_sandcastle_workspace",
        [
          `Disposable worktree already exists with uncommitted changes: ${state.expectedWorktreePath}`,
          removed.message,
        ].join("; "),
        state.expectedWorktreePath,
      );
    }

    state.worktreePath = undefined;
    return { ok: true };
  });

const acquireSandcastleWorktree = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<
  { readonly ok: true; readonly sandbox: SandboxLike } | WorkspaceSetupFailure,
  Error,
  Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.succeed(state.expectedWorktreePath), () =>
      releaseWorktree(input.repoRoot, state, adapters, cleanupResult, cleanupDiagnostics),
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
        workspaceRef: input.workspaceRef,
        tempRefName: state.tempRefName,
        commitSha: input.commitSha,
        worktreeHead: input.commitSha,
        worktreePath: worktree.worktreePath,
        cleanupResult: yield* Ref.get(cleanupResult),
      });
    }

    return { ok: true, sandbox: worktree.sandbox };
  });

const verifyWorktreeHead = <Error>(
  input: RunDisposableExactCommitWorkspaceInput<Error>,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
  sandbox: SandboxLike,
): Effect.Effect<WorkspaceSetupAttempt> =>
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

    if (worktreeHead !== input.commitSha) {
      return setupFailed(
        "create_sandcastle_workspace",
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
  deleteTempRef: (repoRoot, tempRefName) => {
    const result = deleteDisposableWorkspaceRefWithDiagnostic(repoRoot, tempRefName);
    return result.state === "removed" ? { ok: true } : { ok: false, message: result.message };
  },
  allowlistedFileIsRegular: (repoRoot, path) => {
    try {
      return lstatSync(join(repoRoot, path)).isFile();
    } catch {
      return false;
    }
  },
  inspectExistingWorktree,
  removeWorktree: (repoRoot, worktreePath) => {
    const result = removeDisposableWorktreeWithDiagnostic(repoRoot, worktreePath);
    return result.state === "removed" ? { ok: true } : { ok: false, message: result.message };
  },
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
          worktreePath: expectedDisposableWorkspacePath(input.repoRoot, input.tempRefName),
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
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const worktree = yield* cleanupWorktree(repoRoot, state, adapters);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, worktree: worktree.state }));
    if (worktree.state === "failed") {
      yield* Ref.update(cleanupDiagnostics, (current) => ({
        ...current,
        worktree: worktree.diagnostic,
      }));
    }
  });

const cleanupWorktree = (
  repoRoot: string,
  state: WorkspaceScopeState,
  adapters: DisposableExactCommitWorkspaceAdapters,
): Effect.Effect<CleanupStepResult> => {
  if (state.sandbox === undefined && state.worktreePath === undefined) {
    return Effect.succeed({ state: "not_created" });
  }

  return Effect.gen(function* () {
    if (state.sandbox !== undefined) {
      const sandbox = state.sandbox;
      const closeAttempt = yield* Effect.promise(() =>
        closeSandboxWithTimeout(sandbox, cleanupStepTimeoutMs),
      );

      if (!closeAttempt.ok) return { state: "failed" as const, diagnostic: closeAttempt.message };

      const cleanupPath = state.worktreePath ?? state.expectedWorktreePath;

      if (adapters.verifyWorktreeRemoved(repoRoot, cleanupPath))
        return { state: "removed" as const };

      const removed = adapters.removeWorktree(repoRoot, cleanupPath);
      if (removed.ok && adapters.verifyWorktreeRemoved(repoRoot, cleanupPath)) {
        return { state: "removed" as const };
      }
      return {
        state: "failed" as const,
        diagnostic: removed.ok
          ? `Disposable worktree remains after removal: ${cleanupPath}`
          : removed.message,
      };
    }

    if (
      state.worktreePath === undefined ||
      !adapters.inspectExistingWorktree(state.worktreePath).exists
    ) {
      return { state: "not_created" as const };
    }

    const removed = adapters.removeWorktree(repoRoot, state.worktreePath);
    if (removed.ok && adapters.verifyWorktreeRemoved(repoRoot, state.worktreePath)) {
      return { state: "removed" as const };
    }
    return {
      state: "failed" as const,
      diagnostic: removed.ok
        ? `Disposable worktree remains after removal: ${state.worktreePath}`
        : removed.message,
    };
  });
};

type SandcastleCloseResult = { readonly preservedWorktreePath?: string };

type SandcastleCloseAttempt =
  | { readonly ok: true; readonly result: SandcastleCloseResult }
  | { readonly ok: false; readonly message: string };

const closeSandboxWithTimeout = (
  sandbox: SandboxLike,
  timeoutMs: number,
): Promise<SandcastleCloseAttempt> =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve({ ok: false, message: `Sandcastle close timed out after ${timeoutMs} ms.` });
    }, timeoutMs);

    void sandbox.close().then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: true, result });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, message: `Sandcastle close failed: ${errorMessage(error)}` });
      },
    );
  });

const releaseTempRef = (
  repoRoot: string,
  tempRefName: string,
  adapters: DisposableExactCommitWorkspaceAdapters,
  cleanupResult: Ref.Ref<DisposableWorkspaceCleanupResult>,
  cleanupDiagnostics: Ref.Ref<CleanupDiagnostics>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tempRef = adapters.deleteTempRef(repoRoot, tempRefName);
    yield* Ref.update(cleanupResult, (current) => ({
      ...current,
      tempRef: tempRef.ok ? ("removed" as const) : ("failed" as const),
    }));
    if (!tempRef.ok) {
      yield* Ref.update(cleanupDiagnostics, (current) => ({
        ...current,
        tempRef: tempRef.message,
      }));
    }
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
