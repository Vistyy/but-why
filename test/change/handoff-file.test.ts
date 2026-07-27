import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { maxHandoffBytes, readHandoffFile } from "../../src/change/handoffFile.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Change handoff files", () => {
  it("accepts a non-empty file containing only a UTF-8 BOM", () => {
    const root = createTestWorkspace();
    const path = join(root, "bom.md");
    writeFileSync(path, Buffer.from([0xef, 0xbb, 0xbf]));

    expect(readHandoffFile(root, "bom.md")).toEqual({ ok: true, content: "" });
  });

  it.each([
    ["missing", "missing.md", "handoff_file_not_found"],
    ["directory", "handoff-dir", "handoff_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "invalid_handoff_encoding"],
    ["too large", "large.md", "handoff_file_too_large"],
    ["empty", "empty.md", "empty_handoff_file"],
  ] as const)("rejects %s handoff input", (_name, fileName, code) => {
    const root = createTestWorkspace();
    const path = join(root, fileName);

    if (fileName === "handoff-dir") mkdirSync(path);
    if (fileName === "invalid.bin") writeFileSync(path, Buffer.from([0xff]));
    if (fileName === "large.md") writeFileSync(path, "x".repeat(maxHandoffBytes + 1));
    if (fileName === "empty.md") writeFileSync(path, "");

    expect(readHandoffFile(root, fileName)).toMatchObject({ ok: false, error: { code } });
  });
});
