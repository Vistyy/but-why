import { readSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

export type TextInputStdin = {
  readonly fd: number;
  readonly isTerminal: boolean;
};

type TextInputSource = "file" | "stdin";

type TextInputError =
  | { readonly code: "text_input_file_not_found"; readonly path: string }
  | { readonly code: "text_input_file_unreadable"; readonly path: string }
  | { readonly code: "stdin_is_terminal" }
  | { readonly code: "text_input_stdin_unreadable" }
  | {
      readonly code: "text_input_too_large";
      readonly source: TextInputSource;
      readonly path?: string;
      readonly maxBytes: number;
    }
  | {
      readonly code: "text_input_invalid_utf8";
      readonly source: TextInputSource;
      readonly path?: string;
    };

export type TextInputResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: TextInputError };

export type TextInputOptions = {
  readonly maxBytes?: number;
  readonly ignoreBOM?: boolean;
  readonly stdin?: TextInputStdin | undefined;
};

export const readTextInput = (
  cwd: string,
  file: string,
  options: TextInputOptions = {},
): TextInputResult => {
  if (file === "-") return readStdin(options);

  const path = resolve(cwd, file);
  let size: number;

  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      return { ok: false, error: { code: "text_input_file_unreadable", path } };
    }
    size = stats.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, error: { code: "text_input_file_not_found", path } };
    }
    return { ok: false, error: { code: "text_input_file_unreadable", path } };
  }

  if (options.maxBytes !== undefined && size > options.maxBytes) {
    return {
      ok: false,
      error: { code: "text_input_too_large", source: "file", path, maxBytes: options.maxBytes },
    };
  }

  try {
    return decodeText(readFileSync(path), "file", path, options.ignoreBOM);
  } catch {
    return { ok: false, error: { code: "text_input_file_unreadable", path } };
  }
};

const readStdin = (options: TextInputOptions): TextInputResult => {
  const stdin = options.stdin;
  if (stdin?.isTerminal !== false) {
    return { ok: false, error: { code: "stdin_is_terminal" } };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  const chunk = Buffer.alloc(64 * 1024);

  try {
    while (true) {
      const bytesRead = readFileChunk(stdin.fd, chunk);
      if (bytesRead === 0) break;

      totalBytes += bytesRead;
      if (options.maxBytes !== undefined && totalBytes > options.maxBytes) {
        tooLarge = true;
        continue;
      }
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
  } catch {
    return { ok: false, error: { code: "text_input_stdin_unreadable" } };
  }

  if (tooLarge && options.maxBytes !== undefined) {
    return {
      ok: false,
      error: { code: "text_input_too_large", source: "stdin", maxBytes: options.maxBytes },
    };
  }

  return decodeText(Buffer.concat(chunks, totalBytes), "stdin", undefined, options.ignoreBOM);
};

const stdinWaiter = new Int32Array(new SharedArrayBuffer(4));

const readFileChunk = (fd: number, buffer: Buffer): number => {
  while (true) {
    try {
      return readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EAGAIN") throw error;
      Atomics.wait(stdinWaiter, 0, 0, 1);
    }
  }
};

const decodeText = (
  bytes: Uint8Array,
  source: TextInputSource,
  path: string | undefined,
  ignoreBOM: boolean | undefined,
): TextInputResult => {
  try {
    return {
      ok: true,
      content: new TextDecoder("utf-8", { fatal: true, ignoreBOM }).decode(bytes),
    };
  } catch (error) {
    if (error instanceof TypeError) {
      return {
        ok: false,
        error: {
          code: "text_input_invalid_utf8",
          source,
          ...(path === undefined ? {} : { path }),
        },
      };
    }
    return source === "file"
      ? { ok: false, error: { code: "text_input_file_unreadable", path: path ?? "" } }
      : { ok: false, error: { code: "text_input_stdin_unreadable" } };
  }
};

type NodeError = Error & { readonly code?: string };

const isNodeError = (value: unknown): value is NodeError => value instanceof Error;
