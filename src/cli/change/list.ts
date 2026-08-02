// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";

export const runList = (
  command: { readonly all: boolean },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
  const now = environment.now().getTime();
  return loaded.inspection
    .list({
      repositoryCommonDirectory: loaded.commonDirectory,
      includeClosed: command.all,
    })
    .pipe(
      Effect.map((changes) =>
        success({
          changes: changes.map((change) => ({
            id: change.id,
            taskId: change.taskId,
            state: change.state,
            createdAt: change.createdAt,
            ...(change.state === "open"
              ? {
                  ageSeconds: Math.max(0, Math.floor((now - Date.parse(change.createdAt)) / 1_000)),
                }
              : {}),
          })),
        }),
      ),
      support.inspectionFailure,
    );
};
