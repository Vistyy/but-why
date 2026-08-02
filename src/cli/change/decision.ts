// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { success } from "../../cliResults.js";
import { readImplementationDecisionFile } from "../../change/implementationDecisionFile.js";
import { decisionFileError } from "./decisionResults.js";
import * as support from "./changeSupport.js";
import { decisionInputError, decisionMutationError } from "./decisionResults.js";

type ChangeDecisionCommand =
  | { readonly action: "list"; readonly changeId: string }
  | {
      readonly action: "add";
      readonly changeId: string;
      readonly choice: string | undefined;
      readonly rationale: string | undefined;
      readonly file: string | undefined;
    };

type DecisionInputError =
  | "empty_choice"
  | "empty_rationale"
  | "multiline_choice"
  | "missing_fields";

const validateDecisionInput = (
  choice: string,
  rationale: string,
): { readonly ok: true } | { readonly ok: false; readonly code: DecisionInputError } => {
  if (choice.trim() === "") return { ok: false, code: "empty_choice" };
  if (rationale.trim() === "") return { ok: false, code: "empty_rationale" };
  if (choice.includes("\n") || choice.includes("\r"))
    return { ok: false, code: "multiline_choice" };
  return { ok: true };
};

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
    if (command.choice === undefined || command.rationale === undefined) {
      if (command.file === undefined) return Effect.succeed(decisionInputError("missing_fields"));
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
    const validation = validateDecisionInput(command.choice, command.rationale);
    if (!validation.ok) return Effect.succeed(decisionInputError(validation.code));
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection
      .addDecision({
        changeId: command.changeId,
        choice: command.choice,
        rationale: command.rationale,
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
