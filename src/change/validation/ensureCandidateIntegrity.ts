import { Effect } from "effect";
import type {
  WorkspaceCommandExecutionFailed,
  WorkspaceCommandExecutor,
} from "../../command/workspaceCommand.js";

import { GitToolingFailed } from "./validationToolingFailures.js";

export const ensureCandidateIntegrity = (input: {
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd?: string;
  readonly expectedHeadSha: string;
  readonly allowedUntrackedFiles: readonly string[];
}): Effect.Effect<void, GitToolingFailed | WorkspaceCommandExecutionFailed> =>
  Effect.gen(function* () {
    const result = yield* input.commandExecutor(
      "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
      input.commandCwd === undefined ? undefined : { cwd: input.commandCwd },
    );
    const [head, ...status] = result.stdout.trimEnd().split("\n");
    if (
      result.exitCode !== 0 ||
      head !== input.expectedHeadSha ||
      !status.every(
        (line) => line.startsWith("?? ") && input.allowedUntrackedFiles.includes(line.slice(3)),
      )
    ) {
      return yield* new GitToolingFailed({
        operationName: "verify_candidate_head",
        message: "Snapshot Workspace no longer matches the Candidate.",
      });
    }
  });
