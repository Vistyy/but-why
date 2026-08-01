// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { readImplementationDecisionFile } from "../../change/implementationDecisionFile.js";
import { runtimeError, success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import { decisionFileError } from "./decisionResults.js";

type ChangeBlockerCommand =
  | { readonly action: "list"; readonly changeId: string }
  | { readonly action: "raise" | "resolve"; readonly changeId: string; readonly file: string };

export const runBlocker = (
  command: ChangeBlockerCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = command.action;
  const changeId = command.changeId;
  if (action === "list") {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection.blockers(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? support.changeNotFound() : success({ changeId, ...history }),
      ),
      support.inspectionFailure,
    );
  }
  const content = readImplementationDecisionFile(environment.cwd, command.file, environment.stdin);
  if (!content.ok) return Effect.succeed(decisionFileError(content.error));
  const loaded = loadChangeInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
  const operation =
    action === "raise" ? loaded.inspection.raiseBlocker : loaded.inspection.resolveBlocker;
  return operation({
    changeId,
    content: content.content,
    now: environment.now().toISOString(),
  }).pipe(
    Effect.map((result) =>
      result.ok
        ? success({ changeId, blocker: result.blocker, change: result.change })
        : runtimeError({
            code: result.code,
            message: `Cannot ${action} an Implementation Blocker in this Change.`,
            details: { changeId },
            help: ["Inspect the Change and use the applicable blocker lifecycle command."],
          }),
    ),
    support.inspectionFailure,
  );
};
