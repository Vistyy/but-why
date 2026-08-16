// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeFindings } from "../../change/composition/loadChangeInspection.js";
import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import { structuredValue } from "../../output/structuredValue.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

export const runFindings = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "findings", (changeId) => {
    const loaded = loadChangeFindings(support.changeOperationInput(environment));
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.operation(changeId).pipe(
      Effect.map((result) =>
        result === undefined
          ? support.changeNotFound()
          : success({
              change: support.changeInspectionView(result.change),
              candidate: result.candidate,
              validationRun: structuredValue(result.validationRun),
              findings: result.findings,
              toolingFailures: result.toolingFailures,
              count: result.findings.length,
            }),
      ),
      support.inspectionFailure,
    );
  });
