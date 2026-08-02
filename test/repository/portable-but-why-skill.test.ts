import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";

const readSkillArtifact = (path: string): string =>
  readFileSync(join(repoRoot, "docs/public/skills/but-why", path), "utf8");

describe("portable But Why skill", () => {
  it("keeps Operator authority, Task authoring, and handoff in one model-visible skill", () => {
    const skill = readSkillArtifact("SKILL.md");
    const workflow = readSkillArtifact("references/operator-workflow.md");

    expect(skill).toContain("name: but-why");
    expect(skill).not.toContain("disable-model-invocation");
    expect(skill).toContain("Operator workflow");
    expect(skill).toContain("Implement a Change");
    expect(workflow).toContain("**Work Route Selection**");
    expect(workflow).toContain("**Task Recording Authorization**");
    expect(workflow).toContain("**Task Approval**");
    expect(workflow).toContain("**Implementation Authorization**");
    expect(workflow).toContain("Task-backed Change");
    expect(workflow).toContain("taskless Change");
    expect(workflow).toContain("direct edit");
    expect(workflow).toContain("consequential uncertainty");
    expect(workflow).toContain("Task Verification Contract");
    expect(workflow).toContain("Do not require tests by default.");
    expect(workflow).toContain("scripts/launch-handoff.mjs");
    expect(workflow).not.toContain("to-tasks-by");
    expect(workflow).not.toContain("handoff-to-worktree");
  });
});
