import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChangePrepareFailure } from "./change.js";
import { boundedEvidence } from "./preparationEvidence.js";
import { resolvePackageAsset } from "./packageAssetPath.js";

const skillDirectory = resolvePackageAsset("docs/public/skills/but-why");

const implementerContract = (): string =>
  [
    readFileSync(resolve(skillDirectory, "references/command-guidance.md"), "utf8").trim(),
    readFileSync(resolve(skillDirectory, "references/implement-change.md"), "utf8").trim(),
  ].join("\n\n");

export const buildImplementerSystemPrompt = (): string => implementerContract();

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
