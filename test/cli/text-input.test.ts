import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readTextInput } from "../../src/cli/input/textInput.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("bounded text input", () => {
  it("reads explicit stdin as UTF-8 text", () => {
    const root = createTestWorkspace();
    const stdinPath = join(root, "stdin.txt");
    writeFileSync(stdinPath, "  Héllo from stdin.  \n");
    const stdin = openSync(stdinPath, "r");

    try {
      expect(
        readTextInput(root, "-", {
          stdin: { fd: stdin, isTerminal: false },
        }),
      ).toEqual({ ok: true, content: "  Héllo from stdin.  \n", byteLength: 23 });
    } finally {
      closeSync(stdin);
    }
  });

  it("rejects explicit stdin when it is an interactive terminal", () => {
    expect(
      readTextInput(createTestWorkspace(), "-", {
        stdin: { fd: -1, isTerminal: true },
      }),
    ).toEqual({ ok: false, error: { code: "stdin_is_terminal" } });
  });

  it("stops at the configured byte limit", () => {
    const root = createTestWorkspace();
    const stdinPath = join(root, "stdin.txt");
    writeFileSync(stdinPath, "12345");
    const stdin = openSync(stdinPath, "r");

    try {
      expect(
        readTextInput(root, "-", {
          maxBytes: 4,
          stdin: { fd: stdin, isTerminal: false },
        }),
      ).toEqual({
        ok: false,
        error: { code: "text_input_too_large", source: "stdin", maxBytes: 4 },
      });
    } finally {
      closeSync(stdin);
    }
  });

  it("rejects a missing file", () => {
    const root = createTestWorkspace();
    const path = join(root, "missing.md");

    expect(readTextInput(root, "missing.md")).toEqual({
      ok: false,
      error: { code: "text_input_file_not_found", path },
    });
  });

  it("rejects a non-regular file", () => {
    const root = createTestWorkspace();
    const path = join(root, "directory");
    mkdirSync(path);

    expect(readTextInput(root, "directory")).toEqual({
      ok: false,
      error: { code: "text_input_file_unreadable", path },
    });
  });

  it("rejects a file over the byte limit", () => {
    const root = createTestWorkspace();
    const path = join(root, "large.md");
    writeFileSync(path, "12345");

    expect(readTextInput(root, "large.md", { maxBytes: 4 })).toEqual({
      ok: false,
      error: { code: "text_input_too_large", source: "file", path, maxBytes: 4 },
    });
  });

  it("rejects invalid UTF-8 file content", () => {
    const root = createTestWorkspace();
    const path = join(root, "invalid.bin");
    writeFileSync(path, Buffer.from([0xff]));

    expect(readTextInput(root, "invalid.bin")).toEqual({
      ok: false,
      error: { code: "text_input_invalid_utf8", source: "file", path },
    });
  });

  it("reads an empty file as empty content", () => {
    const root = createTestWorkspace();
    const path = join(root, "empty.md");
    writeFileSync(path, "");

    expect(readTextInput(root, "empty.md")).toEqual({
      ok: true,
      content: "",
      byteLength: 0,
    });
  });
});
