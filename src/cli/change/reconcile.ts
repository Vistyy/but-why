// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

import * as support from "./changeSupport.js";
import { reconcileResult } from "./reconcileResult.js";

export const runReconcile = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const changeId = command.changeId;
  return support.withChanges(environment, (changes) =>
    Effect.map(changes.reconcile(changeId, environment.now().toISOString()), (result) =>
      reconcileResult(changeId, result),
    ),
  );
};
