import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";

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
    const workflow = readSkillArtifact("references/operator-workflow.md");

    expect(skill).toContain("name: but-why");
    expect(skill).not.toContain("disable-model-invocation");
    expect(skill).toContain("Operator workflow");
    expect(skill).toContain("Implement a Change");
    expect(workflow).not.toContain("to-tasks-by");
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
    expect(implementerSession).toContain("--task-id <task-id>");
    expect(implementerSession).toContain("--change-id <change-id>");
    expect(implementerSession).toContain("scripts/start-implementer-session.mjs");
    expect(implementerSession).toContain("changeVerified: true");
    expect(authorTasks).toContain("[Task verification](task-verification.md)");
    expect(taskVerification).toContain("Task Verification Contract");
    expect(taskVerification).toContain("Do not require tests by default.");
  });
});
