import { describe, expect, it } from "vitest";

import type { ContractDiagnostic } from "../src/contracts/contractDiagnostics.js";
import { structuredContractDiagnostics } from "../src/output/contractDiagnostics.js";

const diagnostic = (actual: unknown): ContractDiagnostic => ({
  path: ["value"],
  expected: "a supported value",
  actual,
  message: "Value is invalid.",
});

describe("structured contract diagnostics", () => {
  it("preserves nested actual values for structured CLI output", () => {
    const diagnostics = [diagnostic({ nested: [false, null, 42, "text", { missing: undefined }] })];

    expect(structuredContractDiagnostics(diagnostics)).toEqual([
      {
        path: ["value"],
        expected: "a supported value",
        actual: { nested: [false, null, 42, "text", { missing: "<missing>" }] },
        message: "Value is invalid.",
      },
    ]);
  });
});
