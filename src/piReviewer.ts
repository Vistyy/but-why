import { dirname, join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const CLEANUP_MS = 2_000;

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
  if (input.signal.aborted) throw new Error("Reviewer interrupted during setup");

  // Session creation has no AbortSignal API. Observe it even if the caller
  // interrupts while creation is pending, and abort/dispose as soon as available.
  const creation = createAgentSession({
    cwd: input.cwd,
    sessionManager: SessionManager.inMemory(input.cwd),
    resourceLoader: loader,
    tools: ["read", "grep", "find", "ls", "bash"],
  });
  const { session } = await creation;
  let promptTask: Promise<void> | undefined;
  let cleanupTask: Promise<boolean> | undefined;
  const abortSession = () => {
    cleanupTask ??= (async () => {
      const stopped = Promise.allSettled([session.abort(), ...(promptTask ? [promptTask] : [])]);
      return Promise.race([
        stopped.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), CLEANUP_MS)),
      ]);
    })();
    return cleanupTask;
  };
  const abort = () => {
    void abortSession().catch(() => undefined);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  let text = "";
  let settled: boolean;
  try {
    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    promptTask = session.prompt(input.prompt);
    await promptTask;
    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    text = session.getLastAssistantText() ?? "";
    if (!text.trim()) throw new Error("Reviewer produced no final assistant text");
  } finally {
    input.signal.removeEventListener("abort", abort);
    settled = await abortSession();
    session.dispose();
  }
  if (!settled) {
    const error = new Error("Pi reviewer activity did not settle before cleanup bound");
    error.name = "ReviewerActivityUncertain";
    throw error;
  }
  return text;
}
