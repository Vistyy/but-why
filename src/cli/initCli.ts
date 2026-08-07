import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliEnvironment } from "../cli.js";
import {
  type CliResult,
  restoredTransientState,
  runtimeError,
  success,
  usageError,
} from "../cliResults.js";
import { initRepoLocalContext } from "../init/repoContext.js";
import { structuredContractDiagnostics } from "../output/contractDiagnostics.js";

export const runInitCommand = (
  command: { readonly taskPrefix: string },
  environment: CliEnvironment,
): Effect.Effect<CliResult> =>
  initRepoLocalContext({
    cwd: environment.cwd,
    taskPrefix: command.taskPrefix,
  }).pipe(
    Effect.map((initResult) => {
      if (!initResult.ok) {
        switch (initResult.error.code) {
          case "invalid_task_prefix":
            return usageError({
              code: "invalid_task_prefix",
              message: "Task prefix must match ^[A-Z][A-Z0-9]{1,9}$.",
              details: { taskPrefix: initResult.error.taskPrefix },
              help: [
                "Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY.",
              ],
            });
          case "not_git_work_tree":
            return runtimeError({
              code: "not_git_work_tree",
              message: "by init must be run inside a Git work tree.",
              help: ["Run git init first, or cd into an existing Git repository."],
            });
          case "invalid_repo_config":
            return runtimeError({
              code: "invalid_repo_config",
              message: initResult.error.error.message,
              details: {
                path: initResult.error.error.path ?? ".but-why/config.json",
                diagnostics: structuredContractDiagnostics(initResult.error.error.diagnostics),
              },
              help: ["Fix the JSON or move the file aside before running init again."],
            });
          case "task_prefix_conflict":
            return runtimeError({
              code: "task_prefix_conflict",
              message: `Repository is already initialized with task prefix ${initResult.error.existingTaskPrefix}.`,
              details: {
                path: ".but-why/config.json",
                existingTaskPrefix: initResult.error.existingTaskPrefix,
                requestedTaskPrefix: initResult.error.requestedTaskPrefix,
              },
              help: [
                `Keep using ${initResult.error.existingTaskPrefix}, or manually migrate .but-why/config.json before running init again.`,
              ],
            });
          case "invalid_repo_state":
            return runtimeError({
              code: "invalid_repo_state",
              message: `${initResult.error.path} must be a ${initResult.error.expected}.`,
              details: { path: initResult.error.path },
              help: ["Move the conflicting path aside before running init again."],
            });
          case "shared_state_identity_conflict":
            return runtimeError({
              code: "shared_state_identity_conflict",
              message: "Shared But Why? state belongs to a different Git repository.",
              help: [
                "Restore the repository's own shared state, then run `by init --task-prefix <prefix>`.",
              ],
            });
          case "restored_transient_state":
            return restoredTransientState(initResult.error.tasks, initResult.error.changes);
        }
      }

      return success({
        init: {
          status: initResult.status,
          root: initResult.root,
          taskPrefix: initResult.taskPrefix,
        },
        ...(initResult.created.length > 0 ? { created: initResult.created } : {}),
        ...(initResult.updated.length > 0 ? { updated: initResult.updated } : {}),
        validationSetup: validationSetupGuidance(publicDocs(environment)),
      });
    }),
  );

type PublicDocs = {
  readonly setup: string;
  readonly config: string;
};

const publicDocs = (environment: CliEnvironment): PublicDocs => {
  const executablePath = realExecutablePath(environment.executablePath);
  const packageRoot = resolve(dirname(executablePath), "..");

  return {
    setup: join(packageRoot, "docs/public/setup.md"),
    config: join(packageRoot, "docs/public/config.md"),
  };
};

const realExecutablePath = (executablePath: string): string => {
  try {
    return realpathSync(executablePath);
  } catch {
    return resolve(executablePath);
  }
};

const validationSetupGuidance = (docs: PublicDocs) => ({
  policyFile: ".but-why/config.json",
  policy: "tracked repo policy",
  configDoc: docs.config,
  setupDoc: docs.setup,
  guidance: [
    { step: "inspect", detail: "Inspect repo tooling before choosing validation commands." },
    {
      step: "configure",
      detail:
        "Configure top-level prepare and validation.checks to the best of your ability from observed tooling.",
    },
    { step: "review", detail: "Keep .but-why/config.json explicit and reviewable." },
  ],
});
