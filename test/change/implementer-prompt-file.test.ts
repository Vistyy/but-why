import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readImplementerPromptFile } from "../../src/cli/change/implementerPromptFile.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Change implementer prompt files", () => {
  it("accepts a non-empty file containing only a UTF-8 BOM", () => {
    const root = createTestWorkspace();
    const path = join(root, "bom.md");
    writeFileSync(path, Buffer.from([0xef, 0xbb, 0xbf]));

    expect(readImplementerPromptFile(root, "bom.md")).toEqual({ ok: true, content: "" });
  });
});
