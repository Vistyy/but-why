// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { withChangeReconciliation } from "../../change/composition/loadChangeLifecycle.js";
import type { CliResult } from "../../cliResults.js";
import { usageError } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { reconcileResult } from "./reconcileResult.js";

export const runReconcile = (
  command: { readonly changeId: string | undefined; readonly discardWork: boolean },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const changeId = command.changeId;
  if (command.discardWork && changeId === undefined) {
    return Effect.succeed(
      usageError({
        code: "discard_requires_change_id",
        message: "--discard-work requires one exact terminal Change ID.",
        help: ["Run `by change reconcile <change-id> --discard-work` for one exact Change."],
      }),
    );
  }
  return support.loadedChangeOperation(
    withChangeReconciliation(support.changeOperationInput(environment), (reconcile) =>
      Effect.map(
        reconcile(changeId, environment.now().toISOString(), command.discardWork),
        (result) => reconcileResult(changeId, result, command.discardWork),
      ),
    ),
  );
};
