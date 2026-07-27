import { resolve } from "node:path";

import type { TextInputStdin } from "../../cli/input/textInput.js";
import { readTextInput } from "../../cli/input/textInput.js";

export type CommentFileReadResult =
  | {
      readonly ok: true;
      readonly content: string;
    }
  | {
      readonly ok: false;
      readonly error: CommentFileReadError;
    };

export type CommentFileReadError =
  | {
      readonly code: "comment_file_not_found";
      readonly path: string;
    }
  | {
      readonly code: "comment_file_unreadable";
      readonly path: string;
    }
  | {
      readonly code: "empty_comment";
      readonly path: string;
    }
  | { readonly code: "stdin_is_terminal" };

export const readCommentFile = (
  cwd: string,
  commentFile: string,
  stdin?: TextInputStdin,
): CommentFileReadResult => {
  const input = readTextInput(cwd, commentFile, {
    ignoreBOM: true,
    stdin,
  });
  if (!input.ok) {
    switch (input.error.code) {
      case "text_input_file_not_found":
        return { ok: false, error: { code: "comment_file_not_found", path: input.error.path } };
      case "text_input_file_unreadable":
      case "text_input_stdin_unreadable":
        return {
          ok: false,
          error: {
            code: "comment_file_unreadable",
            path: input.error.code === "text_input_file_unreadable" ? input.error.path : "-",
          },
        };
      case "text_input_too_large":
      case "text_input_invalid_utf8":
        return {
          ok: false,
          error: {
            code: "comment_file_unreadable",
            path: input.error.path ?? "-",
          },
        };
      case "stdin_is_terminal":
        return { ok: false, error: { code: "stdin_is_terminal" } };
    }
  }

  if (input.content.trim().length === 0) {
    return {
      ok: false,
      error: { code: "empty_comment", path: commentFile === "-" ? "-" : resolve(cwd, commentFile) },
    };
  }

  return { ok: true, content: input.content };
};
