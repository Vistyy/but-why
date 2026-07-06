import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

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
    };

export const readCommentFile = (cwd: string, commentFile: string): CommentFileReadResult => {
  const path = resolve(cwd, commentFile);

  try {
    const stats = statSync(path);

    if (!stats.isFile()) {
      return { ok: false, error: { code: "comment_file_unreadable", path } };
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, error: { code: "comment_file_not_found", path } };
    }

    return { ok: false, error: { code: "comment_file_unreadable", path } };
  }

  let content: string;

  try {
    const bytes = readFileSync(path);
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, error: { code: "comment_file_unreadable", path } };
  }

  if (content.trim().length === 0) {
    return { ok: false, error: { code: "empty_comment", path } };
  }

  return { ok: true, content };
};

type NodeError = Error & {
  readonly code?: string;
};

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
