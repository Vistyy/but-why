import { resolve } from "node:path";

import type { TextInputStdin } from "../../cli/input/textInput.js";
import { readTextInput } from "../../cli/input/textInput.js";

const maxDescriptionBytes = 256 * 1024;

export type DescriptionFileReadResult =
  | {
      readonly ok: true;
      readonly content: string;
    }
  | {
      readonly ok: false;
      readonly error: DescriptionFileReadError;
    };

export type DescriptionFileReadError =
  | {
      readonly code: "description_file_not_found";
      readonly path: string;
    }
  | {
      readonly code: "description_file_unreadable";
      readonly path: string;
    }
  | {
      readonly code: "description_too_large";
      readonly path: string;
      readonly maxBytes: number;
    }
  | {
      readonly code: "invalid_description_encoding";
      readonly path: string;
    }
  | {
      readonly code: "empty_description";
      readonly path: string;
    }
  | { readonly code: "stdin_is_terminal" };

export const readDescriptionFile = (
  cwd: string,
  descriptionFile: string,
  stdin?: TextInputStdin,
): DescriptionFileReadResult => {
  const input = readTextInput(cwd, descriptionFile, {
    maxBytes: maxDescriptionBytes,
    stdin,
  });
  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_file_not_found":
        return { ok: false, error: { code: "description_file_not_found", path: input.error.path } };
      case "text_input_file_unreadable":
      case "text_input_stdin_unreadable":
        return {
          ok: false,
          error: {
            code: "description_file_unreadable",
            path: input.error.code === "text_input_file_unreadable" ? input.error.path : "-",
          },
        };
      case "text_input_too_large":
        return {
          ok: false,
          error: {
            code: "description_too_large",
            path: input.error.path ?? "-",
            maxBytes: input.error.maxBytes,
          },
        };
      case "text_input_invalid_utf8":
        return {
          ok: false,
          error: { code: "invalid_description_encoding", path: input.error.path ?? "-" },
        };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
    }
  }

  if (input.content.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "empty_description",
        path: descriptionFile === "-" ? "-" : resolve(cwd, descriptionFile),
      },
    };
  }

  return { ok: true, content: input.content };
};
