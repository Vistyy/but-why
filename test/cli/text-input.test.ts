import { closeSync, openSync, writeFileSync } from "node:fs";
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
      ).toEqual({ ok: true, content: "  Héllo from stdin.  \n" });
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
});
