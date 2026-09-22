import { dirname, join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export async function reviewWithPi(input: {
  cwd: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<string> {
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: join(dirname(input.cwd), "empty-agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt:
      "You are an independent code reviewer. Follow only the gate-owned review instructions.",
    appendSystemPrompt: [],
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  if (
    loader.getAgentsFiles().agentsFiles.length ||
    loader.getAppendSystemPrompt().length ||
    loader.getSkills().skills.length ||
    loader.getPrompts().prompts.length ||
    loader.getExtensions().extensions.length
  )
    throw new Error("Pi resource loader discovered untrusted reviewer context");
  const { session } = await createAgentSession({
    cwd: input.cwd,
    sessionManager: SessionManager.inMemory(input.cwd),
    resourceLoader: loader,
    tools: ["read", "grep", "find", "ls", "bash"],
  });
  try {
    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    await session.prompt(input.prompt);
    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    return session.getLastAssistantText() ?? "";
  } finally {
    session.dispose();
  }
}
