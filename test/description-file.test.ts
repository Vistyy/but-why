import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readDescriptionFile } from "../src/task/files/descriptionFile.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

describe("Task description files", () => {
  it("resolves files relative to the caller directory and preserves exact content", () => {
    const root = createTestWorkspace();
    const descriptions = createTestWorkspace();
    const path = join(descriptions, "task.md");
    writeFileSync(path, "  Exact description.  \n");

    expect(readDescriptionFile(root, path)).toEqual({
      ok: true,
      content: "  Exact description.  \n",
    });
  });

  it.each([
    ["not found", "missing.md", "description_file_not_found"],
    ["unreadable", "description-dir", "description_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "invalid_description_encoding"],
    ["too large", "large.txt", "description_too_large"],
    ["empty", "empty.txt", "empty_description"],
  ] as const)("reports %s input", (_name, fileName, code) => {
    const root = createTestWorkspace();
    const path = join(root, fileName);

    if (fileName === "description-dir") {
      mkdirSync(path);
    } else if (fileName === "invalid.bin") {
      writeFileSync(path, Buffer.from([0xff]));
    } else if (fileName === "large.txt") {
      writeFileSync(path, "x".repeat(256 * 1024 + 1));
    } else if (fileName === "empty.txt") {
      writeFileSync(path, "   \n");
    }

    expect(readDescriptionFile(root, fileName)).toMatchObject({ ok: false, error: { code } });
  });
});
