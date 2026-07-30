import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/public/skills/but-why",
);

const implementerContract = (): string =>
  [
    readFileSync(resolve(skillDirectory, "references/command-guidance.md"), "utf8").trim(),
    readFileSync(resolve(skillDirectory, "references/implement-change.md"), "utf8").trim(),
  ].join("\n\n");

export const buildImplementerSystemPrompt = (): string => implementerContract();

export const buildImplementerInitialPrompt = (input: {
  readonly changeId: string;
  readonly worktreePath: string;
  readonly handoff?: string;
}): string =>
  [
    `Change identity: ${input.changeId}.`,
    `Managed Worktree: ${input.worktreePath}.`,
    ...(input.handoff === undefined ? [] : [input.handoff]),
  ].join("\n\n");
