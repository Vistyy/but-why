import { type CliResult, runtimeError, usageError } from "../../cliResults.js";

export const decisionMutationError = (code: string, changeId: string): CliResult =>
  runtimeError({
    code,
    message:
      code === "change_not_found"
        ? "Change was not found."
        : code === "submission_in_progress"
          ? "Change Submission is in progress."
          : "Change is closed.",
    details: { changeId },
    help:
      code === "submission_in_progress"
        ? ["Wait for Change Submit to finish, then retry the Implementation Decision command."]
        : ["Use an open Change ID."],
  });

export const decisionInputError = (
  code: "empty_choice" | "empty_rationale" | "multiline_choice",
): CliResult =>
  usageError({
    code,
    message:
      code === "empty_choice"
        ? "Implementation Decision Choice is required and must not be empty."
        : code === "empty_rationale"
          ? "Implementation Decision Rationale is required and must not be empty."
          : "Implementation Decision Choice must be one line.",
    help: ["Provide --choice <one-line approach> and --rationale <reason>."],
  });
