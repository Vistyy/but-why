// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { readHandoffFile } from "../../change/handoffFile.js";
import { runtimeError } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import { handoffFileError, implementResult } from "./implementResult.js";
import { openHerdrInteractiveSessionHost } from "../../change/herdrInteractiveSessionHost.js";

export const bundledInteractiveSessionHost = openHerdrInteractiveSessionHost;

export const runImplement = (
  command: { readonly changeId: string | undefined; readonly handoffFile: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const handoff =
    command.handoffFile === undefined
      ? undefined
      : readHandoffFile(environment.cwd, command.handoffFile, environment.stdin);
  if (handoff !== undefined && !handoff.ok) return Effect.succeed(handoffFileError(handoff.error));

  return support.withResolvedChangeId(command.changeId, environment, "implement", (changeId) =>
    support.withChanges(
      environment,
      (changes) =>
        Effect.map(
          changes.implement(changeId, handoff === undefined ? undefined : handoff.content),
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
