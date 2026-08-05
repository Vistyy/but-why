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
  it("keeps Operator authority, Task authoring, and handoff in one model-visible skill", () => {
    const skill = readSkillArtifact("SKILL.md");
    const workflow = readSkillArtifact("references/operator-workflow.md");

    expect(skill).toContain("name: but-why");
    expect(skill).not.toContain("disable-model-invocation");
    expect(skill).toContain("Operator workflow");
    expect(skill).toContain("Implement a Change");
    expect(workflow).not.toContain("to-tasks-by");
    expect(workflow).not.toContain("handoff-to-worktree");
  });

  it("orders authority guards before each permitted operation", () => {
    const workflow = readSkillArtifact("references/operator-workflow.md");
    const taskVerification = readSkillArtifact("references/task-verification.md");
    const authority = section(workflow, "Authority");
    const selectRoute = section(workflow, "Select a Work Route");
    const authorTasks = section(workflow, "Author Tasks");
    const approveTask = section(workflow, "Approve a Task");
    const authorizeImplementation = section(workflow, "Authorize Implementation");
    const handoff = section(workflow, "Hand Off an Authorized Change");

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
    expect(approveTask).toContain("Do not start a Change or hand off work");
    expect(authority).toContain("Do not begin implementation, start a Change, or launch a handoff");
    expect(authorizeImplementation).toContain(
      "For a Task-backed Change, confirm that the selected Task is approved and hand it off",
    );
    expect(authorizeImplementation).toContain(
      "For a taskless Change, confirm that the selected work remains taskless and implement it in the current session",
    );
    expect(handoff).toContain("--task-id <task-id>");
    expect(handoff).toContain("--change-id <change-id>");
    expect(handoff).toContain("scripts/launch-handoff.mjs");
    expect(handoff).toContain("changeVerified: true");
    expect(authorTasks).toContain("[Task verification](task-verification.md)");
    expect(taskVerification).toContain("Task Verification Contract");
    expect(taskVerification).toContain("Do not require tests by default.");
  });
});
