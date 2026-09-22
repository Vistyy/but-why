import { dirname, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SelectedModel } from "./model.js";
import { ReviewerActivityUncertain } from "./reviewers.js";

const CLEANUP_MS = 2_000;

export async function openReviewerSession(cwd: string, selected: SelectedModel) {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(dirname(cwd), "empty-agent"),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () =>
      "You are an independent code reviewer. Follow only the gate-owned review instructions.",
    appendSystemPromptOverride: () => [],
  });

  await loader.reload();

  if (
    loader.getAgentsFiles().agentsFiles.length ||
    loader.getAppendSystemPrompt().length ||
    loader.getSkills().skills.length ||
    loader.getPrompts().prompts.length ||
    loader.getExtensions().extensions.length ||
    loader.getThemes().themes.length
  )
    throw new Error("Pi resource loader discovered untrusted reviewer context");

  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader: loader,
    model: selected.model,
    modelRuntime: selected.runtime,
    tools: ["read", "grep", "find", "ls", "bash"],
  });

  return { session, loader };
}

export async function reviewWithPi(
  input: {
    cwd: string;
    prompt: string;
    signal: AbortSignal;
  },
  selected: SelectedModel,
): Promise<string> {
  if (input.signal.aborted) throw new Error("Reviewer interrupted during setup");

  // Session creation has no AbortSignal API. If interrupted while it is pending,
  // the reviewer scheduler preserves the checkout until the activity settles.
  const { session } = await openReviewerSession(input.cwd, selected);
  let promptTask: Promise<void> | undefined;
  let cleanupTask: Promise<boolean> | undefined;

  const abortSession = () => {
    cleanupTask ??= (async () => {
      const stopped = Promise.allSettled([
        session.abort(),
        ...(promptTask ? [promptTask] : []),
      ]).then((results) => results[0]?.status === "fulfilled");

      const timer = new AbortController();

      try {
        return await Promise.race([stopped, pause(CLEANUP_MS, false, { signal: timer.signal })]);
      } finally {
        timer.abort();
      }
    })();

    return cleanupTask;
  };

  const abort = () => {
    void abortSession().catch(() => undefined);
  };

  input.signal.addEventListener("abort", abort, { once: true });
  let text = "";
  let failure: unknown;
  let completed = false;
  let settled = false;

  try {
    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    promptTask = session.prompt(input.prompt);
    await promptTask;

    if (input.signal.aborted) throw new Error("Reviewer interrupted");
    text = session.getLastAssistantText() ?? "";

    const agentError = session.agent.state.errorMessage;

    if (agentError !== undefined && agentError.length > 0)
      throw new Error(`Pi reviewer failed: ${agentError}`);

    if (!text.trim()) throw new Error("Reviewer produced no final assistant text");
    completed = true;
  } catch (cause) {
    failure = cause;
  } finally {
    input.signal.removeEventListener("abort", abort);

    try {
      settled = await abortSession();
      session.dispose();
    } catch {
      settled = false;
    }
  }

  if (!settled)
    throw new ReviewerActivityUncertain({
      message: "Pi reviewer activity did not settle before cleanup bound",
    });

  if (!completed) throw failure;

  return text;
}
