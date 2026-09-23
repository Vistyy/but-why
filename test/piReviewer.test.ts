import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { openReviewerSession, resolveReviewerExtensions } from "../src/piReviewer.js";

it("builds an isolated Pi SDK session without discovering repository instructions or write tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "by-pi-sdk-"));
  const cwd = join(root, "review");
  const agent = join(cwd, ".pi");
  const globalAgent = join(root, "user-agent");
  const previousAgent = process.env["PI_CODING_AGENT_DIR"];

  try {
    process.env["PI_CODING_AGENT_DIR"] = globalAgent;
    await mkdir(join(globalAgent, "extensions"), { recursive: true });
    await writeFile(
      join(globalAgent, "extensions", "ambient.ts"),
      "throw new Error('loaded ambient extension');",
    );
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
    const model = runtime.getModels().find((candidate) => !candidate.reasoning);

    if (model === undefined) throw new Error("Expected a non-reasoning Pi model");

    const selected = {
      slug: { provider: model.provider, id: model.id, value: `${model.provider}/${model.id}` },
      model,
      runtime,
    };

    const { session, loader } = await openReviewerSession(cwd, selected, [], "high");

    try {
      expect(session.agent.state.tools.map((tool) => tool.name).sort()).toEqual(["bash", "read"]);
      expect(session.agent.state.systemPrompt).not.toContain("HOSTILE_");
      expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
      expect(loader.getExtensions().extensions).toEqual([]);
      expect(loader.getSkills().skills).toEqual([]);
      expect(loader.getAppendSystemPrompt()).toEqual([]);
      expect(session.sessionFile).toBeUndefined();
      expect(session.autoCompactionEnabled).toBe(true);
      expect(session.thinkingLevel).toBe("off");
      expect(session.model?.provider).toBe(model.provider);
      expect(session.model?.id).toBe(model.id);
    } finally {
      session.dispose();
    }

    const reasoningModel = runtime
      .getModels()
      .find((candidate) => candidate.reasoning && candidate.thinkingLevelMap?.high !== null);

    if (reasoningModel === undefined) throw new Error("Expected a reasoning Pi model");

    const reasoning = await openReviewerSession(
      cwd,
      {
        ...selected,
        slug: {
          provider: reasoningModel.provider,
          id: reasoningModel.id,
          value: `${reasoningModel.provider}/${reasoningModel.id}`,
        },
        model: reasoningModel,
      },
      [],
      "high",
    );

    try {
      expect(reasoning.session.thinkingLevel).toBe("high");
    } finally {
      reasoning.session.dispose();
    }

    const packageDir = join(root, "reviewer-package");
    const extension = join(packageDir, "extensions", "selected.ts");
    await mkdir(join(packageDir, "extensions"), { recursive: true });
    await mkdir(join(packageDir, "skills", "hostile"), { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        pi: { extensions: ["./extensions"], skills: ["./skills"] },
      }),
    );
    await writeFile(extension, "export default function (pi) { pi.on('agent_start', () => {}); }");
    await writeFile(join(packageDir, "skills", "hostile", "SKILL.md"), "# HOSTILE_PACKAGE_SKILL");
    const chosenPaths = await resolveReviewerExtensions(cwd, [packageDir]);
    expect(chosenPaths).toEqual([extension]);
    const optIn = await openReviewerSession(cwd, selected, chosenPaths, "off");

    try {
      expect(optIn.loader.getExtensions().extensions.map(({ path }) => path)).toEqual([extension]);
      expect(optIn.loader.getSkills().skills).toEqual([]);
      expect(optIn.session.agent.state.systemPrompt).not.toContain("HOSTILE_PACKAGE_SKILL");
      expect(optIn.session.autoCompactionEnabled).toBe(true);
      expect(optIn.session.agent.state.tools.map(({ name }) => name)).not.toContain("write");
    } finally {
      optIn.session.dispose();
    }

    await expect(resolveReviewerExtensions(cwd, [join(root, "missing.ts")])).rejects.toThrow(
      "No Pi extension found",
    );
    await expect(
      openReviewerSession(cwd, selected, [join(root, "missing.ts")], "off"),
    ).rejects.toThrow("Cannot load reviewer extensions");
  } finally {
    if (previousAgent === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previousAgent;
    await rm(root, { recursive: true, force: true });
  }
});
