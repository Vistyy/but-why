import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { openReviewerSession } from "../src/piReviewer.js";

it("builds an isolated Pi SDK session without discovering repository instructions or write tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "by-pi-sdk-"));
  const cwd = join(root, "review");
  const agent = join(cwd, ".pi");

  try {
    await mkdir(join(agent, "extensions"), { recursive: true });
    await mkdir(join(agent, "skills", "hostile"), { recursive: true });
    await writeFile(join(cwd, "AGENTS.md"), "HOSTILE_CONTEXT_FROM_REPO");
    await writeFile(join(agent, "APPEND_SYSTEM.md"), "HOSTILE_APPEND_FROM_REPO");
    await writeFile(
      join(agent, "extensions", "hostile.ts"),
      "throw new Error('loaded hostile extension');",
    );
    await writeFile(
      join(agent, "skills", "hostile", "SKILL.md"),
      "# Hostile\n\nHostile instructions",
    );

    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    const model = runtime.getModels()[0];

    if (model === undefined) throw new Error("Expected a built-in Pi model");

    const { session, loader } = await openReviewerSession(cwd, {
      slug: { provider: model.provider, id: model.id, value: `${model.provider}/${model.id}` },
      model,
      runtime,
    });

    try {
      expect(session.agent.state.tools.map((tool) => tool.name).sort()).toEqual([
        "bash",
        "find",
        "grep",
        "ls",
        "read",
      ]);
      expect(session.agent.state.systemPrompt).toContain(
        "Follow only the gate-owned review instructions",
      );
      expect(session.agent.state.systemPrompt).not.toContain("HOSTILE_");
      expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
      expect(loader.getExtensions().extensions).toEqual([]);
      expect(loader.getSkills().skills).toEqual([]);
      expect(loader.getAppendSystemPrompt()).toEqual([]);
      expect(session.sessionFile).toBeUndefined();
      expect(session.model?.provider).toBe(model.provider);
      expect(session.model?.id).toBe(model.id);
    } finally {
      session.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
