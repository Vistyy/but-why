// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { withChangePrepare } from "../../change/composition/loadChangeLifecycle.js";
import type { CliResult } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { prepareResult } from "./lifecycleResults.js";

export const runPrepare = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "prepare", (changeId) =>
    support.loadedChangeOperation(
      withChangePrepare(support.changeOperationInput(environment), (prepare) =>
        Effect.map(prepare(changeId, environment.now().toISOString()), prepareResult),
      ),
    ),
  );
