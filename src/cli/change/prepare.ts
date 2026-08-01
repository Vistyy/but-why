// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

import * as support from "./changeSupport.js";

export const runPrepare = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "prepare", (changeId) =>
    support.withChanges(environment, (changes) =>
      Effect.map(changes.prepare(changeId, environment.now().toISOString()), support.prepareResult),
    ),
  );
