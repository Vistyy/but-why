import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export type SessionEvent = {
  readonly type: string;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
};

export type RuntimeCase = {
  readonly blocked: boolean;
  readonly providerCalls: number;
  readonly events: readonly SessionEvent[];
  readonly messages: readonly unknown[];
  readonly idle: boolean;
  readonly continuationState: (Record<string, unknown> & { readonly paused?: boolean }) | undefined;
  readonly extensionErrors: readonly unknown[];
};

const [repoRoot, blockedArgument] = process.argv.slice(2);
if (repoRoot === undefined || blockedArgument === undefined) {
  throw new Error("Expected repository root and blocked runtime-case argument.");
}
const blocked = blockedArgument === "blocked";
if (!blocked && blockedArgument !== "normal") {
  throw new Error(`Unknown runtime-case argument: ${blockedArgument}`);
}

const changeId = "BY-C1";
const extensionPath = join(repoRoot, "extensions/continue-change.ts");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const continuationState = (session: { readonly sessionManager: SessionManager }) => {
  const entries = session.sessionManager
    .getBranch()
    .filter(
      (entry) => entry.type === "custom" && entry.customType === "but-why-change-continuation",
    );
  const latest = entries.at(-1);
  const data = latest?.type === "custom" ? latest.data : undefined;
  return isRecord(data)
    ? (data as Record<string, unknown> & { readonly paused?: boolean })
    : undefined;
};

const runRuntimeCase = async (): Promise<RuntimeCase> => {
  const directory = mkdtempSync(join(tmpdir(), "but-why-pi-sdk-"));
  const agentDirectory = join(directory, "agent");
  mkdirSync(agentDirectory);
  const faux = fauxProvider({ provider: "but-why-test" });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf 'tool completed'" }, { id: "tool-call-1" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("second scripted response")),
  ]);

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const resourceLoader = new DefaultResourceLoader({
      cwd: repoRoot,
      agentDir: agentDirectory,
      additionalExtensionPaths: [extensionPath],
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd: repoRoot,
      agentDir: agentDirectory,
      model: faux.getModel(),
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.inMemory(repoRoot),
      thinkingLevel: "off",
      tools: ["bash"],
    });
    session = created.session;
    if (created.extensionsResult.errors.length !== 0) {
      throw new Error(
        `Extension loading failed: ${JSON.stringify(created.extensionsResult.errors)}`,
      );
    }

    const extensionErrors: unknown[] = [];
    const events: SessionEvent[] = [];
    unsubscribe = session.subscribe((event) => {
      events.push(event as SessionEvent);
    });
    await session.bindExtensions({
      onError: (error) => extensionErrors.push(error),
    });
    await session.prompt(`Change identity: ${changeId}.`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (extensionErrors.length !== 0) {
      throw new Error(`Extension execution failed: ${JSON.stringify(extensionErrors)}`);
    }
    return {
      blocked,
      providerCalls: faux.state.callCount,
      events,
      messages: session.messages,
      idle: !session.isStreaming,
      continuationState: continuationState(session),
      extensionErrors,
    };
  } finally {
    unsubscribe?.();
    session?.dispose();
    faux.setResponses([]);
    rmSync(directory, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const result = await runRuntimeCase();
  const output = JSON.stringify(result);
  if (output.length > 1_000_000) throw new Error("Runtime case result exceeded the output bound.");
  process.stdout.write(`${output}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
