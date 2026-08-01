import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  implementationDecisionMarkdown,
  validateImplementationDecisionInput,
} from "../../src/change/implementationDecision.js";
import { readImplementationRationale } from "../../src/change/implementationDecisionFile.js";

describe("Implementation Decisions", () => {
  it("accepts bounded UTF-8 stdin at the rationale character limit", () => {
    const root = mkdtempSync(join(tmpdir(), "but-why-decision-"));
    const path = join(root, "rationale.txt");
    writeFileSync(path, `${"😀".repeat(600)}\n`);
    const fd = openSync(path, "r");
    try {
      expect(readImplementationRationale({ fd, isTerminal: false })).toEqual({
        ok: true,
        rationale: "😀".repeat(600),
      });
    } finally {
      closeSync(fd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects choice line separators and renders escaped collapsed decisions", () => {
    expect(
      validateImplementationDecisionInput({ choice: "one\u2028two", rationale: "Reason." }),
    ).toEqual({ code: "invalid_choice" });
    expect(
      validateImplementationDecisionInput({
        choice: "Use the approach",
        rationale: "Use **bold** text.",
      }),
    ).toEqual({ code: "invalid_rationale" });
    expect(
      validateImplementationDecisionInput({
        choice: "Use the approach",
        rationale: "- Reason.",
      }),
    ).toEqual({ code: "invalid_rationale" });
    expect(
      implementationDecisionMarkdown([
        {
          id: "decision-1",
          changeId: "change-1",
          sequence: 1,
          recordedAt: "time",
          choice: "Use <safe>",
          rationale: "Because & carefully.",
        },
      ]),
    ).toBe(
      "<details>\n<summary>Use &lt;safe&gt;</summary>\n\nBecause &amp; carefully.\n\n</details>",
    );
  });
});
