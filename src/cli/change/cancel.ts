// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { withCancellation } from "../../change/loadChangeCancellation.js";
import type { CliResult } from "../../cliResults.js";
import { usageError } from "../../cliResults.js";
import { changeCancelResult } from "./cancelResult.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

export const runCancel = (
  command: { readonly changeId: string | undefined; readonly reason: string },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.reason.trim().length === 0) {
    return Effect.succeed(
      usageError({
        code: "empty_reason",
        message: "Change cancellation requires a non-empty reason.",
        help: ["Provide a non-empty value for `--reason`."],
      }),
    );
  }
  return support.withResolvedChangeId(command.changeId, environment, "cancel", (changeId) =>
    withCancellation(
      {
        cwd: environment.cwd,
        ...(environment.cancellationUseCases === undefined
          ? {}
          : { cancellationUseCases: environment.cancellationUseCases }),
      },
      (cancellation) =>
        Effect.map(
          cancellation.cancelChange({
            changeId,
            reason: command.reason,
            now: environment.now().toISOString(),
          }),
          changeCancelResult,
        ),
    ),
  );
};
