import { resolve } from "node:path";
import type { TextInputStdin } from "../cli/input/textInput.js";
import { readTextInput } from "../cli/input/textInput.js";

const maxRationaleBytes = 600 * 4 + 2 + 3;
export type ImplementationRationaleInputError =
  | { readonly code: "invalid_rationale_encoding" }
  | { readonly code: "rationale_too_large"; readonly maxBytes: number }
  | { readonly code: "empty_rationale" }
  | { readonly code: "stdin_is_terminal" }
  | { readonly code: "rationale_unreadable" };
export type ImplementationRationaleInputResult =
  | { readonly ok: true; readonly rationale: string }
  | { readonly ok: false; readonly error: ImplementationRationaleInputError };

const maxImplementationDecisionBytes = 256 * 1024;
export type ImplementationDecisionFileError =
  | { readonly code: "decision_file_not_found"; readonly path: string }
  | { readonly code: "decision_file_unreadable"; readonly path: string }
  | { readonly code: "decision_file_too_large"; readonly path: string; readonly maxBytes: number }
  | { readonly code: "invalid_decision_encoding"; readonly path: string }
  | { readonly code: "empty_decision_file"; readonly path: string }
  | { readonly code: "stdin_is_terminal" };
export type ImplementationDecisionFileResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: ImplementationDecisionFileError };

export const readImplementationDecisionFile = (
  cwd: string,
  file: string,
  stdin?: TextInputStdin,
): ImplementationDecisionFileResult => {
  const input = readTextInput(cwd, file, { maxBytes: maxImplementationDecisionBytes, stdin });
  if (!input.ok) {
    const path = "path" in input.error ? input.error.path : file === "-" ? "-" : resolve(cwd, file);
    switch (input.error.code) {
      case "text_input_file_not_found":
        return { ok: false, error: { code: "decision_file_not_found", path } };
      case "text_input_too_large":
        return {
          ok: false,
          error: { code: "decision_file_too_large", path, maxBytes: input.error.maxBytes },
        };
      case "text_input_invalid_utf8":
        return { ok: false, error: { code: "invalid_decision_encoding", path } };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
      default:
        return { ok: false, error: { code: "decision_file_unreadable", path } };
    }
  }
  return input.byteLength === 0
    ? {
        ok: false,
        error: { code: "empty_decision_file", path: file === "-" ? "-" : resolve(cwd, file) },
      }
    : { ok: true, content: input.content };
};

export const readImplementationRationale = (
  stdin: TextInputStdin | undefined,
): ImplementationRationaleInputResult => {
  const input = readTextInput("", "-", { maxBytes: maxRationaleBytes, stdin });
  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_too_large":
        return {
          ok: false,
          error: { code: "rationale_too_large", maxBytes: input.error.maxBytes },
        };
      case "text_input_invalid_utf8":
        return { ok: false, error: { code: "invalid_rationale_encoding" } };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
      case "text_input_stdin_unreadable":
        return { ok: false, error: { code: "rationale_unreadable" } };
      default:
        return { ok: false, error: { code: "rationale_unreadable" } };
    }
  }
  const rationale = input.content.replace(/\r?\n$/u, "");
  return rationale.length === 0
    ? { ok: false, error: { code: "empty_rationale" } }
    : { ok: true, rationale };
};
