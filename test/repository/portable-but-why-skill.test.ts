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
    const implementation = readSkillArtifact("references/implement-change.md");
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
    expect(authorTasks).toContain(
      "Include a `## Review path` section in every proposed Task Context.",
    );
    expect(authorTasks).toContain(
      "State the one coherent judgment that relates the complete result's behavior groups, state relationships, interface changes, and required evidence and shows why they form one bounded supported result that a human can understand and judge.",
    );
    expect(authorTasks).toContain(
      "A sequence of review areas, passes, or verification mechanisms does not supply that judgment.",
    );
    expect(authorTasks).toContain(
      "Use available repository evidence, including evidence from prior implementation attempts, to decide whether the path is practical.",
    );
    expect(authorTasks).toContain(
      "When available evidence has disproved a review path, do not reuse that path or a materially equivalent Task boundary unless concrete evidence shows why the observed mismatch no longer applies.",
    );
    expect(authorTasks).toContain(
      "Treat multiple independently understandable behavior groups, state relationships, interface changes, or verification arguments as boundary evidence requiring either a split or concrete evidence that they form one bounded supported result.",
    );
    expect(authorTasks).toContain("Calling them one subsystem or lifecycle is not that evidence.");
    expect(authorTasks).toContain(
      "No single file, line, effort, or verification count determines the boundary.",
    );
    expect(authorTasks).toContain(
      "Do not turn the review path into a detailed implementation plan, an exact file forecast, a line estimate, or an effort estimate.",
    );
    expect(authorTasks).toContain(
      "Confirm that each review path covers its complete supported result and remains practical in light of the available evidence.",
    );
    expect(authorTasks).toContain(
      "If no practical review path can be stated, present the evidence and concern instead of requesting Task Recording Authorization.",
    );
    expect(authorTasks).toContain("exact Task Contexts including each `## Review path` section");
    expect(taskVerification).toContain("Task Verification Contract");
    expect(taskVerification).toContain(
      "**Required Seam** is a boundary required by a Verification Claim or accepted verification plan because interaction across that boundary is part of the Claim.",
    );
    expect(taskVerification).toContain(
      "Evidence establishes a Verification Claim only through decoded observations that contain the facts the Claim requires.",
    );
    expect(taskVerification).toContain(
      "Missing, malformed, or unavailable observations do not establish the Claim.",
    );
    expect(taskVerification).toContain(
      "establishes each complete Claim through every Required Seam",
    );
    expect(taskVerification).toContain("Do not require tests by default.");
    expect(implementation).toContain(
      "Before implementation, read its accepted `## Review path` as the one coherent judgment that relates the complete result's behavior groups, state relationships, interface changes, and required evidence and shows why they form one bounded supported result that a human can understand and judge.",
    );
    expect(implementation).toContain(
      "A sequence of review areas, passes, or verification mechanisms does not supply that judgment.",
    );
    expect(implementation).toContain(
      "For a Task-backed Change, reassess the accepted review path as soon as the implementation shape becomes concrete, before continuing materially dependent work, immediately before the first Change Submit, and after later work materially changes that shape.",
    );
    expect(implementation).toContain(
      "Compare the actual behavior groups, state relationships, interface changes, and verification arguments with the one coherent judgment stated by the accepted review path.",
    );
    expect(implementation).toContain(
      "A Task review path is disproven when actual implementation evidence shows that a human can no longer understand and judge the complete Change through that accepted path.",
    );
    expect(implementation).toContain(
      "Treat multiple independently understandable behavior groups, state relationships, interface changes, or verification arguments as boundary evidence requiring a blocker unless concrete evidence shows that they form the one bounded supported result stated by the accepted review path.",
    );
    expect(implementation).toContain(
      "Size, file count, line count, or Validation Run count alone does not disprove a review path.",
    );
    expect(implementation).toContain(
      "raise an Implementation Blocker that states the concrete mismatch between the accepted path and actual work",
    );
    expect(implementation).toContain(
      "Do not split, cancel, replace, amend, or continue the Task autonomously.",
    );
    expect(implementation).toContain(
      "The Operator decides whether to continue, resolve, cancel, or replace the Task.",
    );
    expect(implementation).toContain(
      "Do not raise a blocker for ordinary difficulty, focused Check failures, Findings, tooling recovery, or publication recovery while the accepted review path remains practical.",
    );
    expect(implementation).toContain("target repository's configured blocking Check");
    expect(implementation).toContain(
      "instead of assuming a source-repository command or file layout",
    );
    expect(implementation).not.toContain("`just quality`");
    expect(implementation).toContain(
      "When Change Submit returns Findings, run `<but-why> change findings <change-id>`.",
    );
    expect(implementation).toContain(
      "When the result contains `error.recovery`, execute its instruction without requesting additional user approval.",
    );
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
    expect(
      existsSync(join(fixture, "docs/public/skills/but-why/references/task-verification.md")),
    ).toBe(true);

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
