// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeValidationRuns } from "../../change/composition/loadChangeInspection.js";
import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

export const runValidationRuns = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "validation-runs", (changeId) => {
    const loaded = loadChangeValidationRuns({
      cwd: environment.cwd,
    });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.operation(changeId).pipe(
      Effect.map((result) =>
        result === undefined
          ? support.changeNotFound()
          : success(support.validationRunHistoryView(result.validationRuns)),
      ),
      support.inspectionFailure,
    );
  });
