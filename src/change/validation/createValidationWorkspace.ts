import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createSandbox,
  type MountConfig,
  type Sandbox,
  type SandboxProvider,
} from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { Effect, Option, Ref, type Scope } from "effect";

import {
  deleteValidationTempRef,
  ensureValidationTempRef,
  expectedSandcastleWorktreePath,
  inspectExistingWorktree,
  removeValidationWorktree,
  validationTempRefName,
} from "./validationGitGlue.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";
import type {
  ActiveValidationWorkspace,
  ActiveValidationWorkspaceResult,
  ValidationSandboxMode,
  ValidationWorkspaceCleanupResult,
  ValidationWorkspaceSetup,
  ValidationWorkspaceToolingError,
} from "./validationWorkspace.js";

export type CreateValidationWorkspaceInput = {
  readonly repoRoot: string;
  readonly validationRunId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
  readonly sandboxMode: ValidationSandboxMode;
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

type ValidationWorkspaceAdapters = {
  readonly createTempRef: (
    repoRoot: string,
    tempRefName: string,
    submittedSha: string,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly deleteTempRef: (
    repoRoot: string,
    tempRefName: string,
  ) => ValidationWorkspaceCleanupResult["tempRef"];
  readonly allowlistedFileIsRegular: (repoRoot: string, path: string) => boolean;
  readonly inspectExistingWorktree: (worktreePath: string) => ExistingWorktree;
  readonly removeWorktree: (repoRoot: string, worktreePath: string) => CleanupAttempt;
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

type WorkspaceSetupAttempt = WorkspaceSetupSuccess | WorkspaceSetupFailure;

type WorkspaceSetupSuccess = {
  readonly ok: true;
  readonly setup: Omit<ValidationWorkspaceSetup, "cleanupResult">;
  readonly activeWorkspaceResult?: ActiveValidationWorkspaceResult;
};

type WorkspaceSetupFailure = {
  readonly ok: false;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly worktreePath?: string;
};

const cleanupStepTimeoutMs = 5_000;

const initialCleanupResult: ValidationWorkspaceCleanupResult = {
  worktree: "not_created",
  tempRef: "not_created",
};

const validationSandboxProvider = (
  mode: ValidationSandboxMode,
  parentContextPath: string | undefined,
  webSearchPath: string | undefined,
): SandboxProvider => {
  switch (mode) {
    case "none":
      return noSandbox();
    case "docker":
      return docker({ mounts: reviewerPiResourceMounts(parentContextPath, webSearchPath) });
    case "podman":
      return podman({ mounts: reviewerPiResourceMounts(parentContextPath, webSearchPath) });
  }
};

const reviewerPiResourceMounts = (
  parentContextPath: string | undefined,
  webSearchPath: string | undefined,
): readonly MountConfig[] => {
  const agentRoot = join(homedir(), ".pi", "agent");
  const requiredResources = [
    "extensions/package-manager-policy",
    "extensions/web-search",
    "skills/codebase-design",
  ];
  const contextFiles = ["AGENTS.md", "CLAUDE.md"].filter((file) =>
    existsSync(join(agentRoot, file)),
  );

  return [
    ...requiredResources
      .filter((resource) => resource !== "extensions/web-search")
      .map((resource) => reviewerPiMount(agentRoot, resource)),
    {
      hostPath: webSearchPath ?? join(agentRoot, "extensions/web-search"),
      sandboxPath: "/home/agent/.pi/agent/extensions/web-search",
      readonly: true,
    },
    ...contextFiles.map((file) => reviewerPiMount(agentRoot, file)),
    ...(parentContextPath === undefined
      ? []
      : [
          {
            hostPath: parentContextPath,
            sandboxPath: "/home/agent/AGENTS.md",
            readonly: true,
          },
        ]),
  ];
};

const reviewerPiMount = (agentRoot: string, resource: string): MountConfig => ({
  hostPath: join(agentRoot, resource),
  sandboxPath: `/home/agent/.pi/agent/${resource}`,
  readonly: true,
});

const createReviewerWebSearchResource = (): string => {
  const source = join(homedir(), ".pi", "agent", "extensions", "web-search");
  const stagingRoot = mkdtempSync(join(tmpdir(), "but-why-reviewer-web-search-"));
  const staged = join(stagingRoot, "web-search");
  cpSync(source, staged, { dereference: true, recursive: true });

  let piTuiEntry: string;
  try {
    piTuiEntry = createRequire(join(source, "index.js")).resolve("@earendil-works/pi-tui");
  } catch {
    return staged;
  }

  const piTuiRoot = realpathSync(dirname(dirname(piTuiEntry)));
  const dependencyRoot = dirname(dirname(piTuiRoot));
  const stagedPiTuiRoot = join(staged, "node_modules", "@earendil-works", "pi-tui");
  mkdirSync(dirname(stagedPiTuiRoot), { recursive: true });
  cpSync(piTuiRoot, stagedPiTuiRoot, { dereference: true, recursive: true });

  for (const dependency of ["marked", "get-east-asian-width"]) {
    const dependencyPath = join(dependencyRoot, dependency);
    if (!existsSync(dependencyPath)) continue;
    const stagedDependencyPath = join(stagedPiTuiRoot, "node_modules", dependency);
    mkdirSync(dirname(stagedDependencyPath), { recursive: true });
    cpSync(realpathSync(dependencyPath), stagedDependencyPath, {
      dereference: true,
      recursive: true,
    });
  }

  return staged;
};

const createReviewerParentContextFile = (repoRoot: string): string | undefined => {
  const contextParts: string[] = [];
  let directory = dirname(repoRoot);

  while (true) {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(directory, file);
      if (!existsSync(path)) continue;
      try {
        contextParts.unshift(`<!-- ${path} -->\n${readFileSync(path, "utf8")}`);
      } catch {
        // Ignore unreadable parent context files. Pi also treats them as unavailable.
      }
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (contextParts.length === 0) return undefined;

  const contextDirectory = mkdtempSync(join(tmpdir(), "but-why-reviewer-context-"));
  const contextPath = join(contextDirectory, "AGENTS.md");
  writeFileSync(contextPath, contextParts.join("\n\n"));
  return contextPath;
};

export const createValidationWorkspace = (
  input: CreateValidationWorkspaceInput,
): Effect.Effect<CreateValidationWorkspaceResult, RepositoryStorageError> =>
  createValidationWorkspaceWithAdapters(input, productionValidationWorkspaceAdapters).pipe(
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

const toolingFailureResult = (toolingFailure: ValidationToolingFailure) =>
  Effect.succeed({ ok: false as const, toolingFailure });

const createValidationWorkspaceWithAdapters = (
  input: CreateValidationWorkspaceInput,
  adapters: ValidationWorkspaceAdapters,
): Effect.Effect<
  CreateValidationWorkspaceResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    const tempRefName = validationTempRefName(input.validationRunId);
    const expectedWorktreePath = expectedSandcastleWorktreePath(input.repoRoot, tempRefName);
    const cleanupResult = yield* Ref.make<ValidationWorkspaceCleanupResult>(initialCleanupResult);
    const state: WorkspaceScopeState = {
      tempRefName,
      expectedWorktreePath,
      sandbox: undefined,
      worktreePath: undefined,
    };

    const scopedSetup = Effect.scoped(
      setupValidationWorkspaceScope(input, state, adapters, cleanupResult),
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
          operationName: "cleanup_validation_workspace",
          tempRefName,
          submittedSha: input.submittedSha,
          ...(state.worktreePath === undefined ? {} : { worktreePath: state.worktreePath }),
          errorMessage: "Validation workspace cleanup failed after successful setup.",
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

const withInterruptedCleanupRecording = (
  scopedSetup: Effect.Effect<
    WorkspaceSetupAttempt,
    ValidationToolingFailure | RepositoryStorageError
  >,
  input: CreateValidationWorkspaceInput,
  tempRefName: string,
  expectedWorktreePath: string,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
): Effect.Effect<WorkspaceSetupAttempt, ValidationToolingFailure | RepositoryStorageError> => {
  const recordInterruptedCleanupResult = input.recordInterruptedCleanupResult;

  if (recordInterruptedCleanupResult === undefined) {
    return scopedSetup;
  }

  return Effect.onInterrupt(scopedSetup, () =>
    Effect.gen(function* () {
      const finalCleanupResult = yield* Ref.get(cleanupResult);
      yield* recordInterruptedCleanupResult({
        operationName: "validation_workspace_interrupted",
        tempRefName,
        submittedSha: input.submittedSha,
        worktreePath: expectedWorktreePath,
        errorMessage: "Validation workspace setup was interrupted.",
        cleanupResult: finalCleanupResult,
      }).pipe(
        Effect.catchAllDefect(() => Effect.void),
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.ignore,
      );
    }),
  );
};

const setupValidationWorkspaceScope = (
  input: CreateValidationWorkspaceInput,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
): Effect.Effect<
  WorkspaceSetupAttempt,
  ValidationToolingFailure | RepositoryStorageError,
  Scope.Scope
> =>
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

    const verifiedWorkspace = yield* verifyWorktreeHead(
      input,
      state,
      adapters,
      worktreeAttempt.sandbox,
    );

    if (!verifiedWorkspace.ok) {
      return verifiedWorkspace;
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
  input: CreateValidationWorkspaceInput,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
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
  input: CreateValidationWorkspaceInput,
  adapters: ValidationWorkspaceAdapters,
): { readonly ok: true } | WorkspaceSetupFailure => {
  for (const path of input.copyFiles) {
    if (!adapters.allowlistedFileIsRegular(input.repoRoot, path)) {
      return setupFailed(
        "copy_allowlisted_file",
        `Allowlisted validation workspace file is missing: ${path}`,
      );
    }
  }

  return { ok: true };
};

const prepareExistingWorktree = (
  input: CreateValidationWorkspaceInput,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
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
      `Validation worktree already exists for a different Validation Run: ${state.expectedWorktreePath}`,
    );
  }

  if (existingWorktree.head !== input.submittedSha) {
    return setupFailed(
      "create_sandcastle_workspace",
      `Validation worktree already exists for a different commit: ${state.expectedWorktreePath}`,
    );
  }

  if (!existingWorktree.dirty) {
    return { ok: true };
  }

  state.worktreePath = state.expectedWorktreePath;
  const removed = adapters.removeWorktree(input.repoRoot, state.expectedWorktreePath);

  if (!removed.ok && adapters.inspectExistingWorktree(state.expectedWorktreePath).exists) {
    return setupFailed(
      "create_sandcastle_workspace",
      `Validation worktree already exists with uncommitted changes: ${state.expectedWorktreePath}`,
      state.expectedWorktreePath,
    );
  }

  state.worktreePath = undefined;
  return { ok: true };
};

const acquireSandcastleWorktree = (
  input: CreateValidationWorkspaceInput,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
): Effect.Effect<
  { readonly ok: true; readonly sandbox: SandboxLike } | WorkspaceSetupFailure,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const parentContextPath =
      input.sandboxMode === "none"
        ? undefined
        : yield* Effect.acquireRelease(
            Effect.sync(() => createReviewerParentContextFile(input.repoRoot)),
            (path) =>
              Effect.sync(() => {
                if (path !== undefined) rmSync(dirname(path), { force: true, recursive: true });
              }),
          );
    const webSearchPath =
      input.sandboxMode === "none"
        ? undefined
        : yield* Effect.acquireRelease(Effect.sync(createReviewerWebSearchResource), (path) =>
            Effect.sync(() => rmSync(dirname(path), { force: true, recursive: true })),
          );

    yield* Effect.acquireRelease(Effect.succeed(state.expectedWorktreePath), () =>
      releaseWorktree(input.repoRoot, state, adapters, cleanupResult),
    );

    state.worktreePath = state.expectedWorktreePath;
    const worktree = yield* adapters.createSandcastleWorktree({
      repoRoot: input.repoRoot,
      tempRefName: state.tempRefName,
      copyFiles: input.copyFiles,
      sandboxProvider: validationSandboxProvider(
        input.sandboxMode,
        parentContextPath,
        webSearchPath,
      ),
    });

    if (!worktree.ok) {
      state.worktreePath = worktree.worktreePath ?? state.expectedWorktreePath;
      return setupFailed("create_sandcastle_workspace", worktree.message, state.worktreePath);
    }

    state.sandbox = worktree.sandbox;
    state.worktreePath = worktree.worktreePath;

    return { ok: true, sandbox: worktree.sandbox };
  });

const verifyWorktreeHead = (
  input: CreateValidationWorkspaceInput,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
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

    if (worktreeHead !== input.submittedSha) {
      return setupFailed(
        "create_sandcastle_workspace",
        `Validation worktree HEAD ${worktreeHead} did not match submitted SHA ${input.submittedSha}.`,
        state.worktreePath,
      );
    }

    return {
      ok: true,
      setup: {
        validationRunId: input.validationRunId,
        tempRefName: state.tempRefName,
        submittedSha: input.submittedSha,
        worktreeHead,
      },
    } satisfies WorkspaceSetupAttempt;
  });

const productionValidationWorkspaceAdapters: ValidationWorkspaceAdapters = {
  createTempRef: (repoRoot, tempRefName, submittedSha) =>
    Effect.sync(() => ensureValidationTempRef(repoRoot, tempRefName, submittedSha)),
  deleteTempRef: (repoRoot, tempRefName) => deleteValidationTempRef(repoRoot, tempRefName),
  allowlistedFileIsRegular: (repoRoot, path) => {
    try {
      return lstatSync(join(repoRoot, path)).isFile();
    } catch {
      return false;
    }
  },
  inspectExistingWorktree,
  removeWorktree: (repoRoot, worktreePath) =>
    removeValidationWorktree(repoRoot, worktreePath)
      ? { ok: true }
      : { ok: false, message: "Validation worktree removal failed." },
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
          worktreePath: expectedSandcastleWorktreePath(input.repoRoot, input.tempRefName),
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
  adapters: ValidationWorkspaceAdapters,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const worktree = yield* cleanupWorktree(repoRoot, state, adapters);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, worktree }));
  });

const cleanupWorktree = (
  repoRoot: string,
  state: WorkspaceScopeState,
  adapters: ValidationWorkspaceAdapters,
): Effect.Effect<ValidationWorkspaceCleanupResult["worktree"]> => {
  if (state.sandbox === undefined && state.worktreePath === undefined) {
    return Effect.succeed("not_created");
  }

  return Effect.gen(function* () {
    if (state.sandbox !== undefined) {
      const closeResult = yield* Effect.tryPromise({
        try: (): Promise<{ readonly preservedWorktreePath?: string }> =>
          state.sandbox?.close() ?? Promise.resolve({}),
        catch: () => undefined,
      }).pipe(
        Effect.timeoutOption(`${cleanupStepTimeoutMs} millis`),
        Effect.catchAll(() => Effect.succeed(Option.none())),
      );

      if (Option.isNone(closeResult)) return "failed";

      const preservedPath = closeResult.value.preservedWorktreePath ?? state.worktreePath;

      if (preservedPath === undefined || !adapters.inspectExistingWorktree(preservedPath).exists) {
        return "removed";
      }

      return adapters.removeWorktree(repoRoot, preservedPath).ok ? "removed" : "failed";
    }

    if (
      state.worktreePath === undefined ||
      !adapters.inspectExistingWorktree(state.worktreePath).exists
    ) {
      return "not_created";
    }

    return adapters.removeWorktree(repoRoot, state.worktreePath).ok ? "removed" : "failed";
  });
};

const releaseTempRef = (
  repoRoot: string,
  tempRefName: string,
  adapters: ValidationWorkspaceAdapters,
  cleanupResult: Ref.Ref<ValidationWorkspaceCleanupResult>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tempRef = adapters.deleteTempRef(repoRoot, tempRefName);
    yield* Ref.update(cleanupResult, (current) => ({ ...current, tempRef }));
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
