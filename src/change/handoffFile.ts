import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

export const maxHandoffBytes = 256 * 1024;

export type HandoffFileReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: HandoffFileReadError };

export type HandoffFileReadError =
  | { readonly code: "handoff_file_not_found"; readonly path: string }
  | { readonly code: "handoff_file_unreadable"; readonly path: string }
  | { readonly code: "handoff_file_too_large"; readonly path: string; readonly maxBytes: number }
  | { readonly code: "invalid_handoff_encoding"; readonly path: string }
  | { readonly code: "empty_handoff_file"; readonly path: string };

export const readHandoffFile = (cwd: string, handoffFile: string): HandoffFileReadResult => {
  const path = resolve(cwd, handoffFile);
  let size: number;

  try {
    const stats = statSync(path);
    if (!stats.isFile()) return { ok: false, error: { code: "handoff_file_unreadable", path } };
    size = stats.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, error: { code: "handoff_file_not_found", path } };
    }
    return { ok: false, error: { code: "handoff_file_unreadable", path } };
  }

  if (size === 0) return { ok: false, error: { code: "empty_handoff_file", path } };
  if (size > maxHandoffBytes) {
    return {
      ok: false,
      error: { code: "handoff_file_too_large", path, maxBytes: maxHandoffBytes },
    };
  }

  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    return { ok: true, content };
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, error: { code: "invalid_handoff_encoding", path } };
    }
    return { ok: false, error: { code: "handoff_file_unreadable", path } };
  }
};

type NodeError = Error & { readonly code?: string };

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
