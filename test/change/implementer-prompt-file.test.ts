import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  maxImplementerPromptBytes,
  readImplementerPromptFile,
} from "../../src/cli/change/implementerPromptFile.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Change implementer prompt files", () => {
  it("accepts a non-empty file containing only a UTF-8 BOM", () => {
    const root = createTestWorkspace();
    const path = join(root, "bom.md");
    writeFileSync(path, Buffer.from([0xef, 0xbb, 0xbf]));

    expect(readImplementerPromptFile(root, "bom.md")).toEqual({ ok: true, content: "" });
  });

  it.each([
    ["missing", "missing.md", "implementer_prompt_file_not_found"],
    ["directory", "implementer-prompt-dir", "implementer_prompt_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "invalid_implementer_prompt_encoding"],
    ["too large", "large.md", "implementer_prompt_file_too_large"],
    ["empty", "empty.md", "empty_implementer_prompt_file"],
  ] as const)("rejects %s implementer prompt input", (_name, fileName, code) => {
    const root = createTestWorkspace();
    const path = join(root, fileName);

    if (fileName === "implementer-prompt-dir") mkdirSync(path);
    if (fileName === "invalid.bin") writeFileSync(path, Buffer.from([0xff]));
    if (fileName === "large.md") writeFileSync(path, "x".repeat(maxImplementerPromptBytes + 1));
    if (fileName === "empty.md") writeFileSync(path, "");

    expect(readImplementerPromptFile(root, fileName)).toMatchObject({ ok: false, error: { code } });
  });
});
