// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { decisionInputError, decisionMutationError } from "./decisionResults.js";

type ChangeDecisionCommand =
  | { readonly action: "list"; readonly changeId: string }
  | {
      readonly action: "add";
      readonly changeId: string;
      readonly choice: string;
      readonly rationale: string;
    };

type DecisionInputError = "empty_choice" | "empty_rationale" | "multiline_choice";

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
  if (command.action === "list") {
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
};
