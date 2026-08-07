import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

const readSkillArtifact = (path: string): string =>
  readFileSync(join(repoRoot, "docs/public/skills/but-why", path), "utf8");

const section = (source: string, heading: string): string => {
  const start = source.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error(`Missing ${heading} section.`);
  const end = source.indexOf("\n## ", start + heading.length + 4);
  return source.slice(start, end < 0 ? undefined : end);
};

describe("portable But Why skill", () => {
  it("keeps Operator authority, Task authoring, and Implementation Authorization in one model-visible skill", () => {
    const skill = readSkillArtifact("SKILL.md");
    expect(skill).toContain("name: but-why");
    expect(skill).not.toContain("disable-model-invocation");
    expect(skill).toContain("Operator workflow");
    expect(skill).toContain("Implement a Change");
  });

  it("orders authority guards before each permitted operation", () => {
    const workflow = readSkillArtifact("references/operator-workflow.md");
    const taskVerification = readSkillArtifact("references/task-verification.md");
    const authority = section(workflow, "Authority");
    const selectRoute = section(workflow, "Select a Work Route");
    const authorTasks = section(workflow, "Author Tasks");
    const approveTask = section(workflow, "Approve a Task");
    const authorizeImplementation = section(workflow, "Authorize Implementation");
    const implementerSession = section(
      workflow,
      "Start or Verify an Implementer Interactive Session",
    );

    expect(selectRoute.indexOf("consequential uncertainty")).toBeLessThan(
      selectRoute.indexOf("Obtain the Operator's explicit Work Route Selection"),
    );
    expect(authorTasks.indexOf("Task Recording Authorization")).toBeLessThan(
      authorTasks.indexOf("Create Tasks in the authorized recording order"),
    );
    expect(authorTasks).toContain(
      "Treat each successful mutation result as authoritative for its returned committed fields.",
    );
    expect(authorTasks).toContain(
      "Verify every recorded Task remains unapproved and has no Change through the returned state or the applicable inspection command.",
    );
    expect(authorTasks).not.toContain("by task approve");
    expect(approveTask).toContain("by task approve <task-id>");
    expect(approveTask).toContain(
      "Do not start a Change or launch an Implementer Interactive Session",
    );
    expect(authority).toContain(
      "Do not begin implementation or start a Change without Implementation Authorization",
    );
    expect(authority).toContain(
      "A Task-backed Change Implementation Authorization requires starting or verifying a fresh Implementer Interactive Session.",
    );
    expect(authorizeImplementation).toContain(
      "For a Task-backed Change, confirm that the selected Task is approved and start or verify a fresh Implementer Interactive Session",
    );
    expect(authorizeImplementation).toContain(
      "For a taskless Change, confirm that the selected work remains taskless and implement it in the current session",
    );
    expect(implementerSession).toContain("change implement <change-id>");
    expect(implementerSession).toContain("Do not repeat the Change ID, Task ID");
    expect(implementerSession).toContain("Do not retry an uncertain start or initial prompt.");
    expect(authorTasks).toContain("[Task verification](task-verification.md)");
    expect(taskVerification).toContain("Task Verification Contract");
    expect(taskVerification).toContain("Do not require tests by default.");
  });

  it("preserves Change Submit long-running caller guidance", () => {
    const implementation = readSkillArtifact("references/implement-change.md");

    expect(implementation).toContain(
      "Change Submit is a long-running command, as classified by its CLI help.",
    );
    expect(implementation).toContain(
      "Run it without a caller timeout when the execution harness supports that behavior.",
    );
    expect(implementation).toContain(
      "When the execution harness requires a finite timeout, allow at least 30 minutes.",
    );
    expect(implementation).toContain(
      "Increase the timeout when configured phase limits or reviewer duration require more time.",
    );
  });

  it("is discoverable through Pi from the packaged skill layout and references shipped setup guidance", () => {
    const fixture = createTestWorkspace();
    cpSync(join(repoRoot, "package.json"), join(fixture, "package.json"));
    cpSync(join(repoRoot, "docs", "public", "skills"), join(fixture, "docs", "public", "skills"), {
      recursive: true,
    });

    const skill = readSkillArtifact("SKILL.md");
    expect(skill).toContain("[Setup guidance](../../setup.md)");
    expect(existsSync(join(repoRoot, "docs/public/skills/but-why/../../setup.md"))).toBe(true);

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
