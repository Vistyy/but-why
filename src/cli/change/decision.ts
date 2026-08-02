// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { readImplementationDecisionFile } from "../../change/implementationDecisionFile.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import { decisionFileError, decisionMutationError } from "./decisionResults.js";

type ChangeDecisionCommand =
  | { readonly action: "list"; readonly changeId: string }
  | { readonly action: "add"; readonly changeId: string; readonly file: string };

export const runDecision = (
  command: ChangeDecisionCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = command.action;
  if (action === "list") {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection.decisions(command.changeId).pipe(
      Effect.map((decisions) =>
        decisions === undefined
          ? support.changeNotFound()
          : success({ changeId: command.changeId, count: decisions.length, decisions }),
      ),
      support.inspectionFailure,
    );
  }
  {
    const content = readImplementationDecisionFile(
      environment.cwd,
      command.file,
      environment.stdin,
    );
    if (!content.ok) return Effect.succeed(decisionFileError(content.error));
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection
      .addDecision({
        changeId: command.changeId,
        content: content.content,
        now: environment.now().toISOString(),
      })
      .pipe(
        Effect.map((result) =>
          result.ok
            ? success({ changeId: command.changeId, decision: result.decision })
            : decisionMutationError(result.code, command.changeId),
        ),
        support.inspectionFailure,
      );
  }
};
