import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/by-cli.js";

const skillPath = join(repoRoot, "skills/handoff-to-worktree/SKILL.md");

describe("handoff-to-worktree skill", () => {
  it("is user-invoked and creates, launches, and removes a compact temporary handoff", () => {
    const skill = readFileSync(skillPath, "utf8");
    const packageManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      readonly pi?: { readonly skills?: readonly string[] };
    };

    const setup = readFileSync(join(repoRoot, "docs/public/setup.md"), "utf8");

    expect(packageManifest.pi?.skills).toEqual(["./skills"]);
    expect(setup).toContain("skills/handoff-to-worktree/SKILL.md");
    expect(setup).toContain("pi install npm:but-why");
    expect(skill).toContain("name: handoff-to-worktree");
    expect(skill).toContain("disable-model-invocation: true");
    expect(skill).toContain("but-why-handoff.XXXXXX.md");
    expect(skill).toContain("trap 'rm -f \"$handoff_file\"' EXIT");
    expect(skill).toContain("by change start --output json");
    expect(skill).toContain(
      'by change implement <change-id> --handoff-file "$handoff_file" --output json',
    );
    expect(skill).toContain("report the structured failure in this session");
    expect(skill).toContain("Do not copy, fork, switch, or retarget the current Pi session.");
  });
});
