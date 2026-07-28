import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/public/skills/but-why",
);

export const buildImplementerPrompt = (input: {
  readonly changeId: string;
  readonly worktreePath: string;
  readonly handoff?: string;
}): string =>
  [
    readFileSync(resolve(skillDirectory, "SKILL.md"), "utf8").trim(),
    readFileSync(resolve(skillDirectory, "references/implement-change.md"), "utf8").trim(),
    [
      `Change identity: ${input.changeId}.`,
      `Managed Worktree: ${input.worktreePath}.`,
      "Implement this Change in the Managed Worktree.",
    ].join("\n"),
    ...(input.handoff === undefined ? [] : [input.handoff]),
  ].join("\n\n");
