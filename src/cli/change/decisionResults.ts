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
