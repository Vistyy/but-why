import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readRecordingText } from "../../src/cli/input/recordingText.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("recording text input", () => {
  it("resolves files relative to the caller directory and preserves opaque content", () => {
    const root = createTestWorkspace();
    const descriptions = createTestWorkspace();
    const path = join(descriptions, "task.md");
    writeFileSync(path, "  Exact description.  \n\nMarkdown **is** opaque.\n");

    expect(readRecordingText(root, path)).toEqual({
      ok: true,
      content: "  Exact description.  \n\nMarkdown **is** opaque.\n",
    });
  });

  it("ignores a leading UTF-8 BOM", () => {
    const root = createTestWorkspace();
    writeFileSync(join(root, "bom.txt"), Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x4f, 0x4d]));

    expect(readRecordingText(root, "bom.txt")).toEqual({ ok: true, content: "BOM" });
  });

  it("reads explicit stdin with the same policy", () => {
    const root = createTestWorkspace();
    const stdinPath = join(root, "stdin.txt");
    writeFileSync(stdinPath, Buffer.from([0xef, 0xbb, 0xbf, 0x54, 0x65, 0x78, 0x74]));
    const fd = openSync(stdinPath, "r");

    try {
      expect(readRecordingText(root, "-", { fd, isTerminal: false })).toEqual({
        ok: true,
        content: "Text",
      });
    } finally {
      closeSync(fd);
    }
  });

  it.each([
    ["not found", "missing.txt", "recording_text_file_not_found"],
    ["unreadable", "input-dir", "recording_text_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "recording_text_invalid_utf8"],
    ["too large", "large.txt", "recording_text_too_large"],
    ["blank", "blank.txt", "recording_text_blank"],
  ] as const)("reports %s input", (_name, fileName, code) => {
    const root = createTestWorkspace();
    const path = join(root, fileName);

    if (fileName === "input-dir") {
      mkdirSync(path);
    } else if (fileName === "invalid.bin") {
      writeFileSync(path, Buffer.from([0xff]));
    } else if (fileName === "large.txt") {
      writeFileSync(path, "x".repeat(256 * 1024 + 1));
    } else if (fileName === "blank.txt") {
      writeFileSync(path, " \n\t");
    }

    expect(readRecordingText(root, fileName)).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects terminal stdin", () => {
    expect(readRecordingText(createTestWorkspace(), "-", { fd: -1, isTerminal: true })).toEqual({
      ok: false,
      error: { code: "stdin_is_terminal" },
    });
  });
});
