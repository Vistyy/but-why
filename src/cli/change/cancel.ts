// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { withCancellation } from "../../change/loadChangeCancellation.js";
import * as support from "./changeSupport.js";
import { changeCancelResult } from "./cancelResult.js";

export const runCancel = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "cancel", (changeId) =>
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
            now: environment.now().toISOString(),
          }),
          changeCancelResult,
        ),
    ),
  );
