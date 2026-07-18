import type { Sandbox } from "@ai-hero/sandcastle";

import { GitToolingFailed } from "./validationToolingFailures.js";

export const ensureCandidateIntegrity = async (
  sandbox: Pick<Sandbox, "exec">,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Promise<void> => {
  if (expectedHeadSha === undefined) return;
  const result = await sandbox.exec(
    "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
    commandCwd === undefined ? undefined : { cwd: commandCwd },
  );
  const [head, ...status] = result.stdout.trimEnd().split("\n");
  if (
    result.exitCode !== 0 ||
    head !== expectedHeadSha ||
    !status.every(
      (line) => line.startsWith("?? ") && allowedUntrackedFiles?.includes(line.slice(3)) === true,
    )
  ) {
    throw new GitToolingFailed({
      operationName: "verify_candidate_head",
      message: "Validation workspace no longer matches the Candidate.",
    });
  }
};
