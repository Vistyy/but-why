import { resolve } from "node:path";
import type { ChangePrepareFailure } from "../change.js";
import { resolvePackageAsset } from "../packageAssetPath.js";
import { boundedEvidence } from "../preparationEvidence.js";

const skillDirectory = resolvePackageAsset("docs/public/skills/but-why");

export const buildImplementerSystemPromptPaths = (): readonly [string, string] => [
  resolve(skillDirectory, "references/command-guidance.md"),
  resolve(skillDirectory, "references/implement-change.md"),
];

export const buildImplementerInitialPrompt = (input: {
  readonly changeId: string;
  readonly worktreePath: string;
  readonly prepareFailure?: ChangePrepareFailure;
  readonly implementerPrompt?: string;
}): string =>
  [
    `Change identity: ${input.changeId}.`,
    `Managed Worktree: ${input.worktreePath}.`,
    ...(input.prepareFailure === undefined
      ? []
      : [
          "Current Repository Preparation failure in the Managed Worktree:",
          `- command: ${input.prepareFailure.command}`,
          `- exit code: ${input.prepareFailure.exitCode}`,
          `- timed out: ${input.prepareFailure.timedOut}`,
          `- stdout (bounded): ${boundedEvidence(input.prepareFailure.stdout)}`,
          `- stderr (bounded): ${boundedEvidence(input.prepareFailure.stderr)}`,
        ]),
    ...(input.implementerPrompt === undefined ? [] : [input.implementerPrompt]),
  ].join("\n\n");
