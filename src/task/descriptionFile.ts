import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

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
    };

export const readDescriptionFile = (
  cwd: string,
  descriptionFile: string,
): DescriptionFileReadResult => {
  const path = resolve(cwd, descriptionFile);

  let size: number;

  try {
    const stats = statSync(path);

    if (!stats.isFile()) {
      return { ok: false, error: { code: "description_file_unreadable", path } };
    }

    size = stats.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, error: { code: "description_file_not_found", path } };
    }

    return { ok: false, error: { code: "description_file_unreadable", path } };
  }

  if (size > maxDescriptionBytes) {
    return {
      ok: false,
      error: { code: "description_too_large", path, maxBytes: maxDescriptionBytes },
    };
  }

  let content: string;

  try {
    const bytes = readFileSync(path);
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, error: { code: "invalid_description_encoding", path } };
    }

    return { ok: false, error: { code: "description_file_unreadable", path } };
  }

  if (content.trim().length === 0) {
    return { ok: false, error: { code: "empty_description", path } };
  }

  return { ok: true, content };
};

type NodeError = Error & {
  readonly code?: string;
};

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
