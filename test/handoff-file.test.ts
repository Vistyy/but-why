import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { maxHandoffBytes, readHandoffFile } from "../src/change/handoffFile.js";
import { cleanupTempRoots, createTempRoot } from "./support/by-cli.js";

afterEach(cleanupTempRoots);

describe("Change handoff files", () => {
  it("preserves a non-empty UTF-8 handoff through the 256 KiB limit", () => {
    const root = createTempRoot();
    const path = join(root, "handoff.md");
    const handoff = "x".repeat(maxHandoffBytes);
    writeFileSync(path, handoff);

    expect(readHandoffFile(root, "handoff.md")).toEqual({ ok: true, content: handoff });
  });

  it.each([
    ["missing", "missing.md", "handoff_file_not_found"],
    ["directory", "handoff-dir", "handoff_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "invalid_handoff_encoding"],
    ["too large", "large.md", "handoff_file_too_large"],
    ["empty", "empty.md", "empty_handoff_file"],
  ] as const)("rejects %s handoff input", (_name, fileName, code) => {
    const root = createTempRoot();
    const path = join(root, fileName);

    if (fileName === "handoff-dir") mkdirSync(path);
    if (fileName === "invalid.bin") writeFileSync(path, Buffer.from([0xff]));
    if (fileName === "large.md") writeFileSync(path, "x".repeat(maxHandoffBytes + 1));
    if (fileName === "empty.md") writeFileSync(path, "");

    expect(readHandoffFile(root, fileName)).toMatchObject({ ok: false, error: { code } });
  });
});
