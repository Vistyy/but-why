// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";

export const runPublications = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "publications", (changeId) => {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection.publications(changeId).pipe(
      Effect.map((publications) =>
        publications === undefined
          ? support.changeNotFound()
          : success({
              changeId,
              count: publications.length,
              publications,
              ...(publications.length === 0
                ? { message: "No Candidate Publications recorded." }
                : {}),
            }),
      ),
      support.inspectionFailure,
    );
  });
