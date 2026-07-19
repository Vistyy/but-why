import type { Sandbox } from "@ai-hero/sandcastle";

import { GitToolingFailed } from "./validationToolingFailures.js";

export const ensureCandidateIntegrity = async (input: {
  readonly sandbox: Pick<Sandbox, "exec">;
  readonly commandCwd?: string;
  readonly expectedHeadSha: string;
  readonly allowedUntrackedFiles: readonly string[];
}): Promise<void> => {
  const result = await input.sandbox.exec(
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
    throw new GitToolingFailed({
      operationName: "verify_candidate_head",
      message: "Validation workspace no longer matches the Candidate.",
    });
  }
};
