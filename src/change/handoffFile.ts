import { resolve } from "node:path";

import type { TextInputStdin } from "../cli/input/textInput.js";
import { readTextInput } from "../cli/input/textInput.js";

export const maxHandoffBytes = 256 * 1024;

export type HandoffFileReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: HandoffFileReadError };

export type HandoffFileReadError =
  | { readonly code: "handoff_file_not_found"; readonly path: string }
  | { readonly code: "handoff_file_unreadable"; readonly path: string }
  | { readonly code: "handoff_file_too_large"; readonly path: string; readonly maxBytes: number }
  | { readonly code: "invalid_handoff_encoding"; readonly path: string }
  | { readonly code: "empty_handoff_file"; readonly path: string }
  | { readonly code: "stdin_is_terminal" };

export const readHandoffFile = (
  cwd: string,
  handoffFile: string,
  stdin?: TextInputStdin,
): HandoffFileReadResult => {
  const input = readTextInput(cwd, handoffFile, {
    maxBytes: maxHandoffBytes,
    stdin,
  });
  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_file_not_found":
        return { ok: false, error: { code: "handoff_file_not_found", path: input.error.path } };
      case "text_input_file_unreadable":
      case "text_input_stdin_unreadable":
        return {
          ok: false,
          error: {
            code: "handoff_file_unreadable",
            path: input.error.code === "text_input_file_unreadable" ? input.error.path : "-",
          },
        };
      case "text_input_too_large":
        return {
          ok: false,
          error: {
            code: "handoff_file_too_large",
            path: input.error.path ?? "-",
            maxBytes: input.error.maxBytes,
          },
        };
      case "text_input_invalid_utf8":
        return {
          ok: false,
          error: { code: "invalid_handoff_encoding", path: input.error.path ?? "-" },
        };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
    }
  }

  if (input.byteLength === 0) {
    return {
      ok: false,
      error: {
        code: "empty_handoff_file",
        path: handoffFile === "-" ? "-" : resolve(cwd, handoffFile),
      },
    };
  }

  return { ok: true, content: input.content };
};
