import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { supportedAgentRuntimes } from "../src/agent/runtimeAdapters.js";

describe("supported agent runtimes", () => {
  it("keeps the public setup guide synchronized with the adapter registry", () => {
    const guide = readFileSync("docs/public/setup.md", "utf8");
    const section = guide.match(
      /<!-- supported-agent-runtimes:start -->\n([\s\S]*?)<!-- supported-agent-runtimes:end -->/u,
    );

    expect(section).not.toBeNull();
    const documented = [...(section?.[1] ?? "").matchAll(/^- `([^`]+)`$/gmu)].map(
      (match) => match[1] ?? "",
    );
    expect(documented).toEqual(supportedAgentRuntimes);
  });
});
