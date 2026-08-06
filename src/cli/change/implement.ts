// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import { runtimeError } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { readImplementerPromptFile } from "./implementerPromptFile.js";
import { implementerPromptFileError, implementResult } from "./implementResult.js";
export const runImplement = (
  command: {
    readonly changeId: string | undefined;
    readonly implementerPromptFile: string | undefined;
  },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const implementerPrompt =
    command.implementerPromptFile === undefined
      ? undefined
      : readImplementerPromptFile(
          environment.cwd,
          command.implementerPromptFile,
          environment.stdin,
        );
  if (implementerPrompt !== undefined && !implementerPrompt.ok)
    return Effect.succeed(implementerPromptFileError(implementerPrompt.error));

  return support.withResolvedChangeId(command.changeId, environment, "implement", (changeId) =>
    support.withChanges(
      environment,
      (changes) =>
        Effect.map(
          changes.implement(
            changeId,
            implementerPrompt === undefined ? undefined : implementerPrompt.content,
          ),
          implementResult,
        ),
      () =>
        runtimeError({
          code: "launch_failed",
          message: "But Why? could not launch the Interactive Session.",
          help: ["Confirm Herdr is running, then retry Change Implement."],
        }),
    ),
  );
};
