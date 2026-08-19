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
