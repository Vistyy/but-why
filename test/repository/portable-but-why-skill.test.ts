import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

type PiProbe = {
  readonly prompt: string;
  readonly commands: readonly string[];
};

const portableSkillInstallTimeoutMs = 30_000;
const portableSkillProcessTimeoutMs = 10_000;

describe("portable But Why skill", () => {
  it("is discoverable through Pi from the packaged skill layout", () => {
    const fixture = createTestWorkspace();
    cpSync(join(repoRoot, "package.json"), join(fixture, "package.json"));
    cpSync(join(repoRoot, "docs", "public", "skills"), join(fixture, "docs", "public", "skills"), {
      recursive: true,
    });

    const consumer = createTestWorkspace();
    const agentDirectory = join(createTestWorkspace(), "agent");
    const probeOutput = join(consumer, "probe.json");
    const probeExtension = join(consumer, "probe.mjs");
    writeFileSync(
      probeExtension,
      [
        'import { writeFileSync } from "node:fs";',
        "export default function probe(pi) {",
        '  pi.registerCommand("probe", { description: "Probe skill discovery", handler: async (_args, ctx) => {',
        "    writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify({ prompt: ctx.getSystemPrompt(), commands: pi.getCommands().map((command) => command.name) }));",
        "  } });",
        "}",
        "",
      ].join("\n"),
    );
    const pi = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const environment = { PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: "1" };
    const install = runTestProcess(process.execPath, [pi, "install", fixture], {
      cwd: consumer,
      env: environment,
      isolatedHome: createTestWorkspace(),
      timeout: portableSkillInstallTimeoutMs,
    });
    expect(install.status, `${install.stdout}${install.stderr}`).toBe(0);
    const probe = runTestProcess(
      process.execPath,
      [pi, "--mode", "rpc", "--no-session", "--extension", probeExtension],
      {
        cwd: consumer,
        env: { ...environment, PROBE_OUTPUT: probeOutput },
        isolatedHome: createTestWorkspace(),
        input: '{"type":"prompt","message":"/probe","id":"probe"}\n',
        timeout: portableSkillProcessTimeoutMs,
      },
    );
    expect(probe.status, `${probe.stdout}${probe.stderr}`).toBe(0);
    const result = JSON.parse(readFileSync(probeOutput, "utf8")) as PiProbe;
    expect(result.prompt).toContain("but-why");
    expect(result.commands).toContain("skill:but-why");
  }, 60_000);
});
