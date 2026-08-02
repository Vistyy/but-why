import { runtimeError, type CliResult } from "../../cliResults.js";
import type { ImplementationDecisionFileError } from "../../change/implementationDecisionFile.js";

export const decisionMutationError = (code: string, changeId: string): CliResult =>
  runtimeError({
    code,
    message: code === "change_not_found" ? "Change was not found." : "Change is closed.",
    details: { changeId },
    help: ["Use an open Change ID."],
  });

export const decisionFileError = (error: ImplementationDecisionFileError): CliResult =>
  runtimeError({
    code: error.code,
    message:
      error.code === "stdin_is_terminal"
        ? "Standard input is an interactive terminal."
        : "Implementation Decision content could not be read.",
    details: "path" in error ? { path: error.path } : {},
    help: [
      error.code === "stdin_is_terminal"
        ? "Pipe UTF-8 Markdown or use a regular file."
        : "Provide a bounded UTF-8 Markdown file with `--file <path>`.",
    ],
  });

export const decisionInputError = (
  code: "empty_choice" | "empty_rationale" | "multiline_choice" | "missing_fields",
): CliResult =>
  runtimeError({
    code,
    message:
      code === "empty_choice"
        ? "Implementation Decision Choice is required and must not be empty."
        : code === "empty_rationale"
          ? "Implementation Decision Rationale is required and must not be empty."
          : code === "multiline_choice"
            ? "Implementation Decision Choice must be one line."
            : "Implementation Decision Choice and Rationale are required.",
    help: ["Provide --choice <one-line approach> and --rationale <reason>."],
  });
