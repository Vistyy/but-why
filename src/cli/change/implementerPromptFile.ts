import { resolve } from "node:path";

import type { TextInputStdin } from "../input/textInput.js";
import { readTextInput } from "../input/textInput.js";

export const maxImplementerPromptBytes = 256 * 1024;

export type ImplementerPromptFileReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: ImplementerPromptFileReadError };

export type ImplementerPromptFileReadError =
  | { readonly code: "implementer_prompt_file_not_found"; readonly path: string }
  | { readonly code: "implementer_prompt_file_unreadable"; readonly path: string }
  | {
      readonly code: "implementer_prompt_file_too_large";
      readonly path: string;
      readonly maxBytes: number;
    }
  | { readonly code: "invalid_implementer_prompt_encoding"; readonly path: string }
  | { readonly code: "empty_implementer_prompt_file"; readonly path: string }
  | { readonly code: "stdin_is_terminal" };

export const readImplementerPromptFile = (
  cwd: string,
  implementerPromptFile: string,
  stdin?: TextInputStdin,
): ImplementerPromptFileReadResult => {
  const input = readTextInput(cwd, implementerPromptFile, {
    maxBytes: maxImplementerPromptBytes,
    stdin,
  });
  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_file_not_found":
        return {
          ok: false,
          error: { code: "implementer_prompt_file_not_found", path: input.error.path },
        };
      case "text_input_file_unreadable":
      case "text_input_stdin_unreadable":
        return {
          ok: false,
          error: {
            code: "implementer_prompt_file_unreadable",
            path: input.error.code === "text_input_file_unreadable" ? input.error.path : "-",
          },
        };
      case "text_input_too_large":
        return {
          ok: false,
          error: {
            code: "implementer_prompt_file_too_large",
            path: input.error.path ?? "-",
            maxBytes: input.error.maxBytes,
          },
        };
      case "text_input_invalid_utf8":
        return {
          ok: false,
          error: { code: "invalid_implementer_prompt_encoding", path: input.error.path ?? "-" },
        };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
    }
  }

  if (input.byteLength === 0) {
    return {
      ok: false,
      error: {
        code: "empty_implementer_prompt_file",
        path: implementerPromptFile === "-" ? "-" : resolve(cwd, implementerPromptFile),
      },
    };
  }

  return { ok: true, content: input.content };
};
