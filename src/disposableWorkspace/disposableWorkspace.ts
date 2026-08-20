import { resolve } from "node:path";

import { Data, Effect } from "effect";
import type {
  WorkspaceCommandExecutionFailed,
  WorkspaceCommandExecutor,
} from "../command/workspaceCommand.js";

export type DisposableWorkspaceCleanupState = "not_created" | "removed" | "failed";

export type DisposableWorkspaceCleanupResult = {
  readonly workspace: DisposableWorkspaceCleanupState;
  readonly errorMessage?: string;
};

export type DisposableWorktreeInspection =
  | { readonly state: "absent" }
  | { readonly state: "matching"; readonly dirty: boolean }
  | { readonly state: "unproven"; readonly message: string };

export type ExactDisposableWorkspaceCleanupInput = {
  readonly workspaceId: string;
  readonly expectedCommitSha: string;
};

export type ExactDisposableWorkspaceCleanupResult = DisposableWorkspaceCleanupResult;

export type DisposableWorkspaceOperationName =
  | "create_disposable_workspace"
  | "cleanup_disposable_workspace";

export class DisposableWorkspaceIntegrityFailed extends Data.TaggedError(
  "DisposableWorkspaceIntegrityFailed",
)<{
  readonly message: string;
}> {}

class DisposableWorkspaceRestorationFailed extends Data.TaggedError(
  "DisposableWorkspaceRestorationFailed",
)<{
  readonly message: string;
}> {}

export const restoreDisposableWorkspace = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd: string;
  readonly expectedCommitSha: string;
}): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    yield* verifyOwnedDetachedWorktree(input);
    yield* runRestorationCommand(
      input,
      `git reset --hard ${shellQuote(input.expectedCommitSha)} && git clean -fd -- .`,
    );
    yield* verifyOwnedDetachedWorktree(input, true);
    const clean = yield* runWorkspaceCommand(
      input,
      "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
    );
    const [head, ...status] = clean.stdout.trimEnd().split("\n");
    if (head !== input.expectedCommitSha || status.length > 0) {
      return yield* restorationFailed("Disposable Workspace was not clean after restoration.");
    }
  });

const verifyOwnedDetachedWorktree = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
    readonly expectedCommitSha: string;
  },
  requireExpectedHead = false,
): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    const listed = yield* runWorkspaceCommand(input, "git worktree list --porcelain");
    const worktree = parseWorktreeRecords(listed.stdout).find(
      (record) => resolve(record.path) === resolve(input.commandCwd),
    );
    if (worktree === undefined || !worktree.detached) {
      return yield* restorationFailed(
        "Disposable Workspace ownership or detached state could not be verified.",
      );
    }
    if (requireExpectedHead && worktree.head !== input.expectedCommitSha) {
      return yield* restorationFailed(
        "Disposable Workspace registration does not match the expected commit after restoration.",
      );
    }
    const topLevel = yield* runWorkspaceCommand(input, "git rev-parse --show-toplevel");
    if (resolve(topLevel.stdout.trim()) !== resolve(input.commandCwd)) {
      return yield* restorationFailed(
        "Disposable Workspace path does not match the registered worktree.",
      );
    }
    const symbolicHead = yield* runWorkspaceCommand(input, "git symbolic-ref --quiet HEAD");
    if (symbolicHead.exitCode === 0 || symbolicHead.exitCode !== 1) {
      return yield* restorationFailed("Disposable Workspace HEAD is not detached.");
    }
  });

const runRestorationCommand = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
  },
  command: string,
): Effect.Effect<void, DisposableWorkspaceRestorationFailed> =>
  Effect.gen(function* () {
    const result = yield* runWorkspaceCommand(input, command);
    if (result.exitCode !== 0) {
      return yield* restorationFailed(
        [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
          "Disposable Workspace restoration failed.",
      );
    }
  });

const runWorkspaceCommand = (
  input: {
    readonly commandExecutor: WorkspaceCommandExecutor;
    readonly commandCwd: string;
  },
  command: string,
): Effect.Effect<
  { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  DisposableWorkspaceRestorationFailed
> =>
  input.commandExecutor(command, { cwd: input.commandCwd }).pipe(
    Effect.mapError(
      (error) =>
        new DisposableWorkspaceRestorationFailed({
          message: error.message,
        }),
    ),
  );

const restorationFailed = (
  message: string,
): Effect.Effect<never, DisposableWorkspaceRestorationFailed> =>
  Effect.fail(new DisposableWorkspaceRestorationFailed({ message }));

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

type DisposableWorktreeRecord = {
  readonly path: string;
  readonly head?: string;
  readonly detached: boolean;
};

const parseWorktreeRecords = (porcelain: string): readonly DisposableWorktreeRecord[] =>
  porcelain
    .trim()
    .split(/\n\n+/)
    .map((entry) => {
      const lines = entry.split("\n");
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
      return path === undefined
        ? undefined
        : {
            path,
            ...(head === undefined ? {} : { head }),
            detached: lines.includes("detached"),
          };
    })
    .filter((record): record is DisposableWorktreeRecord => record !== undefined);

export const verifyDisposableWorkspaceIntegrity = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd?: string;
  readonly expectedCommitSha: string;
  readonly allowedUntrackedFiles: readonly string[];
}): Effect.Effect<void, DisposableWorkspaceIntegrityFailed | WorkspaceCommandExecutionFailed> =>
  Effect.gen(function* () {
    const result = yield* input.commandExecutor(
      "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
      input.commandCwd === undefined ? undefined : { cwd: input.commandCwd },
    );
    const [head, ...status] = result.stdout.trimEnd().split("\n");
    if (
      result.exitCode !== 0 ||
      head !== input.expectedCommitSha ||
      !status.every(
        (line) => line.startsWith("?? ") && input.allowedUntrackedFiles.includes(line.slice(3)),
      )
    ) {
      return yield* new DisposableWorkspaceIntegrityFailed({
        message: "Disposable Workspace no longer matches the expected exact commit.",
      });
    }
  });

export type DisposableWorkspace = {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly worktreePath: string;
};

export type DisposableWorkspaceError = {
  readonly operationName: DisposableWorkspaceOperationName;
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly worktreePath: string;
  readonly errorMessage: string;
  readonly cleanupResult: DisposableWorkspaceCleanupResult;
};
