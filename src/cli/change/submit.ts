// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeSubmit } from "../../change/composition/loadChangeSubmit.js";
import type { CliResult } from "../../cliResults.js";
import { repositoryStorageErrorResult } from "../../cliResults.js";
import { stderrSubmitProgress } from "../../submission/submissionProgress.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { submitResult } from "./submitResult.js";

export const runSubmit = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "submit", (changeId) => {
    const loaded = loadChangeSubmit({
      cwd: environment.cwd,
      ...(environment.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: environment.reviewerAgentRuntime }),
    });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.submit
      .submit({
        changeId,
        now: environment.now().toISOString(),
        ...(environment.writeStderr === undefined
          ? {}
          : { progress: stderrSubmitProgress(environment.writeStderr) }),
      })
      .pipe(
        Effect.map((result) => submitResult(result, changeId)),
        Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
      );
  });
