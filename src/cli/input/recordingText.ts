import { resolve } from "node:path";

import type { TextInputStdin } from "./textInput.js";
import { readTextInput } from "./textInput.js";

const maxRecordingTextBytes = 256 * 1024;

export type RecordingTextReadError =
  | { readonly code: "recording_text_file_not_found"; readonly path: string }
  | { readonly code: "recording_text_file_unreadable"; readonly path: string }
  | { readonly code: "recording_text_stdin_unreadable" }
  | {
      readonly code: "recording_text_too_large";
      readonly path: string;
      readonly maxBytes: number;
    }
  | { readonly code: "recording_text_invalid_utf8"; readonly path: string }
  | { readonly code: "recording_text_blank"; readonly path: string }
  | { readonly code: "stdin_is_terminal" };

export type RecordingTextReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: RecordingTextReadError };

export const readRecordingText = (
  cwd: string,
  file: string,
  stdin?: TextInputStdin,
): RecordingTextReadResult => {
  const path = file === "-" ? "-" : resolve(cwd, file);
  const input = readTextInput(cwd, file, {
    ignoreBOM: false,
    maxBytes: maxRecordingTextBytes,
    stdin,
  });

  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_file_not_found":
        return { ok: false, error: { code: "recording_text_file_not_found", path } };
      case "text_input_file_unreadable":
        return { ok: false, error: { code: "recording_text_file_unreadable", path } };
      case "text_input_stdin_unreadable":
        return { ok: false, error: { code: "recording_text_stdin_unreadable" } };
      case "text_input_too_large":
        return {
          ok: false,
          error: {
            code: "recording_text_too_large",
            path,
            maxBytes: input.error.maxBytes,
          },
        };
      case "text_input_invalid_utf8":
        return { ok: false, error: { code: "recording_text_invalid_utf8", path } };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
    }
  }

  if (input.content.trim().length === 0) {
    return { ok: false, error: { code: "recording_text_blank", path } };
  }

  return { ok: true, content: input.content };
};
