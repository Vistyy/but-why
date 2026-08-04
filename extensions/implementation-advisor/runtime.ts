import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  loadProjectContextFiles,
  ModelRuntime,
  SessionManager,
  type AgentSessionEvent,
  type ExtensionContext,
  type ExtensionAPI,
  type SessionEntry,
  type ToolDefinition,
  type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  implementationAdvisorRuleIds,
  implementationAdvisorRules,
  type ImplementationAdvisorResponseClass,
  type ImplementationAdvisorRuleId,
} from "./rules.js";
import { buildImplementationAdvisorSystemPrompt } from "./systemPrompt.js";

export const NOTE_TOOL = "implementation_advice";
export const implementationAdvisorToolNames = ["read", "grep", "find", "ls"] as const;

export const implementationAdvisorOutputSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("no_note"),
    activityBatch: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal("note"),
    ruleId: Type.String({ minLength: 1 }),
    responseClass: Type.String({ minLength: 1 }),
    activityBatch: Type.String({ minLength: 1 }),
    evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    problem: Type.String({ minLength: 1 }),
    consequence: Type.String({ minLength: 1 }),
    correction: Type.String({ minLength: 1 }),
  }),
]);

type AdvisorOutput = Static<typeof implementationAdvisorOutputSchema>;
export type AdvisorEvidence = {
  readonly reference: string;
  readonly activity: string;
  readonly input: unknown;
  readonly result: unknown;
  readonly failed: boolean;
};

export type AdvisorNote = {
  readonly ruleId: ImplementationAdvisorRuleId;
  readonly responseClass: ImplementationAdvisorResponseClass;
  readonly activityBatch: string;
  readonly evidence: readonly string[];
  readonly problem: string;
  readonly consequence: string;
  readonly correction: string;
};

type AdvisorState = {
  readonly fingerprints: readonly string[];
  readonly failures: number;
  readonly disabled: boolean;
  readonly latestRejectionReason?: string;
};

export type AdvisorViewerTranscriptEntry = {
  readonly id: string;
  readonly kind: "user" | "assistant" | "tool" | "custom" | "system";
  readonly timestamp: string;
  readonly text: string;
};

export type AdvisorViewerActivity = {
  readonly id: string;
  readonly kind: "assistant" | "tool";
  readonly status: "running" | "complete";
  readonly text: string;
};

export type AdvisorViewerState = {
  readonly sessionId: string | undefined;
  readonly transcript: readonly AdvisorViewerTranscriptEntry[];
  readonly activity: readonly AdvisorViewerActivity[];
  readonly latestRejectionReason: string | undefined;
};

export const createAdvisorViewerState = (input: {
  readonly sessionId: string | undefined;
  readonly entries: readonly SessionEntry[];
  readonly activity: readonly AdvisorViewerActivity[];
  readonly latestRejectionReason: string | undefined;
}): AdvisorViewerState => ({
  sessionId: input.sessionId,
  transcript: input.entries.flatMap(sessionEntryToViewerTranscript),
  activity: input.activity,
  latestRejectionReason: input.latestRejectionReason === undefined
    ? undefined
    : boundViewerText(input.latestRejectionReason, MAX_REJECTION_REASON_LENGTH),
});

type AdvisorViewerListener = (state: AdvisorViewerState) => void;

type AdvisorRuntimeInput = {
  readonly model: string;
  readonly thinking: string | undefined;
  readonly context: {
    readonly changeId: string;
    readonly acceptanceContext: unknown;
    readonly implementationDecisions: readonly unknown[];
  };
  readonly pi: ExtensionAPI;
};

type AdvisorActivityDelta = {
  readonly activityBatch: string;
  readonly evidence: readonly AdvisorEvidence[];
  readonly context: ExtensionContext;
};

const STATE_ENTRY = "but-why.implementation-advisor.state";
const MAX_REJECTION_REASON_LENGTH = 500;
const MAX_VIEWER_ACTIVITY = 24;
const writeTools = new Set(["edit", "write", "bash"]);
const readTools = new Set(["read", "grep", "find", "ls"]);

export const createImplementationAdvisorRuntime = (input: AdvisorRuntimeInput) => {
  let state: AdvisorState = { fingerprints: [], failures: 0, disabled: false };
  let nested: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let activeBatch: {
    readonly activityBatch: string;
    readonly evidence: readonly AdvisorEvidence[];
    readonly acceptanceContext: unknown;
    readonly implementationDecisions: readonly unknown[];
  } | undefined;
  let activeResult: AdvisorOutput | undefined;
  let activeRejectionReason: string | undefined;
  let activeTerminated = false;
  let activeInvestigationEvidence: AdvisorEvidence[] = [];
  const investigationInputs = new Map<string, unknown>();
  const viewerListeners = new Set<AdvisorViewerListener>();
  const viewerActivity = new Map<string, AdvisorViewerActivity>();
  let viewerSequence = 0;
  let activeAssistantActivityId: string | undefined;
  let nestedCreation: Promise<Awaited<ReturnType<typeof createAgentSession>>["session"]> | undefined;
  let contextFiles: ReadonlySet<string> | undefined;
  let worktreeCwd = process.cwd();
  let parentSessionId = input.context.changeId;

  const restore = (context: ExtensionContext): void => {
    try {
      worktreeCwd = context.cwd;
      parentSessionId = context.sessionManager.getSessionId();
      const entries = context.sessionManager.getBranch();
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
        if (isAdvisorState(entry.data)) {
          state = {
            fingerprints: [...entry.data.fingerprints],
            failures: entry.data.failures,
            disabled: entry.data.disabled,
            ...(entry.data.latestRejectionReason === undefined
              ? {}
              : { latestRejectionReason: entry.data.latestRejectionReason }),
          };
        }
        break;
      }
    } catch {
      // Restoration is advisory state. A corrupt or unavailable parent state must not block the Implementer.
    }
  };

  const appendState = (): void => {
    try {
      input.pi.appendEntry(STATE_ENTRY, state);
    } catch {
      // Advisor persistence is fail-open and must not escape the parent event handler.
    }
  };

  const setFailure = (context: ExtensionContext, rejectionReason?: string): void => {
    const failures = state.failures + 1;
    state = {
      ...state,
      failures,
      disabled: failures >= 3,
      ...(rejectionReason === undefined
        ? {}
        : { latestRejectionReason: boundViewerText(rejectionReason, MAX_REJECTION_REASON_LENGTH) }),
    };
    appendState();
    notifyViewerListeners();
    if (failures === 1) {
      context.ui.notify(
        "Implementation Advisor failed open and will retry on the next qualifying activity.",
        "warning",
      );
    }
  };

  const setSuccess = (): void => {
    if (state.failures === 0) return;
    state = { ...state, failures: 0 };
    appendState();
  };

  const ensureContextFiles = (context: ExtensionContext): ReadonlySet<string> => {
    if (contextFiles !== undefined) return contextFiles;
    const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? `${process.env["HOME"] ?? "~"}/.pi/agent`;
    contextFiles = new Set(
      loadProjectContextFiles({ cwd: context.cwd, agentDir })
        .map((file) => resolve(file.path))
        .filter((path) => dirname(path) === resolve(context.cwd)),
    );
    return contextFiles;
  };

  const ensureNestedSession = async (): Promise<Awaited<ReturnType<typeof createAgentSession>>["session"]> => {
    if (nested !== undefined) return nested;
    if (nestedCreation !== undefined) return nestedCreation;
    nestedCreation = (async () => {
      const modelRuntime = await ModelRuntime.create();
      const [provider, ...modelParts] = input.model.split("/");
      const model = modelRuntime.getModel(provider ?? "", modelParts.join("/"));
      if (model === undefined) throw new Error("Configured Implementation Advisor model is unavailable.");
      const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? `${process.env["HOME"] ?? "~"}/.pi/agent`;
      const sessionDirectory = resolve(
        process.env["PI_CODING_AGENT_SESSION_DIR"] ?? resolve(agentDir, "sessions"),
        "implementation-advisor",
        sanitizeSessionId(parentSessionId),
      );
      const resourceLoader = new DefaultResourceLoader({
        cwd: worktreeCwd,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        systemPromptOverride: () =>
          buildImplementationAdvisorSystemPrompt(
            implementationAdvisorRules.map((rule) => rule.contract),
          ),
        appendSystemPromptOverride: () => [],
      });
      await resourceLoader.reload();
      const session = (
        await createAgentSession({
          cwd: worktreeCwd,
          model,
          ...(input.thinking === undefined ? {} : { thinkingLevel: input.thinking as never }),
          tools: [...implementationAdvisorToolNames, NOTE_TOOL],
          resourceLoader,
          sessionManager: SessionManager.continueRecent(worktreeCwd, sessionDirectory),
          customTools: [createAdviceTool()],
        })
      ).session;
      nested = session;
      session.subscribe((event: AgentSessionEvent) => {
        if (event.type === "tool_execution_start" && readTools.has(event.toolName)) {
          investigationInputs.set(event.toolCallId, event.args);
        }
        if (activeBatch !== undefined) {
          const evidence = investigationEvidence(
            event,
            activeBatch.activityBatch,
            investigationInputs.get(event.type === "tool_execution_end" ? event.toolCallId : ""),
          );
          if (event.type === "tool_execution_end") investigationInputs.delete(event.toolCallId);
          if (evidence !== undefined) activeInvestigationEvidence.push(evidence);
        }
        updateViewerActivity(event);
        notifyViewerListeners();
      });
      notifyViewerListeners();
      return session;
    })();
    try {
      return await nestedCreation;
    } finally {
      nestedCreation = undefined;
    }
  };

  const evaluate = async (evaluation: {
    readonly activityBatch: string;
    readonly evidence: readonly AdvisorEvidence[];
    readonly acceptanceContext: unknown;
    readonly implementationDecisions: readonly unknown[];
  }): Promise<AdvisorNote | undefined> => {
    const session = await ensureNestedSession();
    activeBatch = evaluation;
    activeResult = undefined;
    activeRejectionReason = undefined;
    activeTerminated = false;
    activeInvestigationEvidence = [];
    try {
      await session.prompt(buildEvaluationPrompt(evaluation));
    } catch (error) {
      if (activeResult === undefined) throw error;
    }
    const result = activeResult as AdvisorOutput | undefined;
    if (!activeTerminated || result === undefined) {
      throw new AdvisorResultRejectedError(
        activeRejectionReason ?? "Advisor result rejected: no terminating structured output was returned.",
      );
    }
    if (result.kind === "no_note") return undefined;
    return validateAdvisorOutput(result, {
      ...evaluation,
      evidence: [...evaluation.evidence, ...activeInvestigationEvidence],
    });
  };

  const evaluateDelta = async (delta: AdvisorActivityDelta): Promise<void> => {
    if (state.disabled) return;
    try {
      const note = await evaluate({
        activityBatch: delta.activityBatch,
        evidence: delta.evidence,
        acceptanceContext: input.context.acceptanceContext,
        implementationDecisions: input.context.implementationDecisions,
      });
      setSuccess();
      if (note === undefined) return;
      const fingerprint = noteFingerprint(note);
      if (state.fingerprints.includes(fingerprint)) return;
      state = { ...state, fingerprints: [...state.fingerprints, fingerprint] };
      appendState();
      input.pi.sendMessage(
        {
          customType: "but-why.implementation-advisor.note",
          content: `Implementation Advisor note (activity batch ${note.activityBatch}, rule ${note.ruleId}): ${note.problem}\nConsequence: ${note.consequence}\nCorrection: ${note.correction}\nEvidence: ${note.evidence.join(", ")}`,
          display: true,
          details: { ruleId: note.ruleId, activityBatch: note.activityBatch },
        },
        { triggerTurn: false, deliverAs: delta.context.isIdle() ? "nextTurn" : "followUp" },
      );
    } catch (error) {
      setFailure(
        delta.context,
        error instanceof AdvisorResultRejectedError ? error.message : undefined,
      );
    }
  };

  const updateViewerActivity = (event: AgentSessionEvent): void => {
    if (event.type === "message_start" && event.message.role === "assistant") {
      activeAssistantActivityId = `assistant:${viewerSequence++}`;
      viewerActivity.set(activeAssistantActivityId, {
        id: activeAssistantActivityId,
        kind: "assistant",
        status: "running",
        text: agentMessageText(event.message),
      });
    } else if (event.type === "message_update" && event.message.role === "assistant") {
      const id = activeAssistantActivityId ?? `assistant:${viewerSequence++}`;
      activeAssistantActivityId = id;
      viewerActivity.set(id, {
        id,
        kind: "assistant",
        status: "running",
        text: agentMessageText(event.message),
      });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const id = activeAssistantActivityId;
      if (id !== undefined) {
        viewerActivity.set(id, {
          id,
          kind: "assistant",
          status: "complete",
          text: agentMessageText(event.message),
        });
      }
      activeAssistantActivityId = undefined;
    } else if (event.type === "tool_execution_start") {
      viewerActivity.set(`tool:${event.toolCallId}`, {
        id: `tool:${event.toolCallId}`,
        kind: "tool",
        status: "running",
        text: `${event.toolName} ${boundViewerText(safeJson(event.args), 300)}`,
      });
    } else if (event.type === "tool_execution_update") {
      const id = `tool:${event.toolCallId}`;
      viewerActivity.set(id, {
        id,
        kind: "tool",
        status: "running",
        text: `${event.toolName}: ${boundViewerText(safeJson(event.partialResult), 300)}`,
      });
    } else if (event.type === "tool_execution_end") {
      const id = `tool:${event.toolCallId}`;
      viewerActivity.set(id, {
        id,
        kind: "tool",
        status: "complete",
        text: `${event.toolName}: ${boundViewerText(safeJson(event.result), 300)}`,
      });
    }
    while (viewerActivity.size > MAX_VIEWER_ACTIVITY) {
      const oldest = viewerActivity.keys().next().value;
      if (typeof oldest !== "string") break;
      viewerActivity.delete(oldest);
    }
  };

  const getViewerState = (): AdvisorViewerState => {
    const sessionManager = nested?.sessionManager;
    return createAdvisorViewerState({
      sessionId: sessionManager?.getSessionId(),
      entries: sessionManager?.getBranch() ?? [],
      activity: [...viewerActivity.values()],
      latestRejectionReason: state.latestRejectionReason,
    });
  };

  const notifyViewerListeners = (): void => {
    const viewerState = getViewerState();
    for (const listener of viewerListeners) listener(viewerState);
  };

  const scheduler = createAdvisorActivityScheduler<AdvisorActivityDelta>(async (deltas) => {
    await evaluateDelta({
      activityBatch: deltas.map((delta) => delta.activityBatch).join(","),
      evidence: deltas.flatMap((delta) => delta.evidence),
      context: deltas.at(-1)?.context ?? deltas[0]!.context,
    });
  });

  return {
    restore,
    async handleTurnEnd(event: TurnEndEvent, context: ExtensionContext): Promise<void> {
      try {
        worktreeCwd = context.cwd;
        const evidence = turnEvidence(event, ensureContextFiles(context), context.cwd);
        if (evidence.length === 0 || state.disabled) return;
        void scheduler
          .add({
            activityBatch: `turn:${event.turnIndex}`,
            evidence,
            context,
          })
          .catch(() => setFailure(context));
      } catch {
        setFailure(context);
      }
    },
    getState: () => state,
    getNestedSession: () => nested,
    openViewer: ensureNestedSession,
    getViewerState,
    subscribeViewer(listener: AdvisorViewerListener): () => void {
      viewerListeners.add(listener);
      listener(getViewerState());
      return () => viewerListeners.delete(listener);
    },
  };

  function createAdviceTool(): ToolDefinition<typeof implementationAdvisorOutputSchema> {
    return {
      name: NOTE_TOOL,
      label: "Implementation advice",
      description: "Return exactly one validated no-note or note result for the current batch.",
      parameters: implementationAdvisorOutputSchema,
      execute: async (_toolCallId, value, _signal, _onUpdate, toolContext) => {
        if (!activeTerminated && activeBatch !== undefined && Value.Check(implementationAdvisorOutputSchema, value)) {
          activeResult = value;
          activeTerminated = true;
        } else if (!activeTerminated) {
          activeRejectionReason = "Advisor result rejected: output does not match the required schema.";
        }
        toolContext.abort();
        return { content: [{ type: "text", text: "Structured result recorded." }], details: {} };
      },
    };
  }
};

export class AdvisorResultRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisorResultRejectedError";
  }
}

export const validateAdvisorOutput = (
  value: AdvisorOutput,
  evaluation: {
    readonly activityBatch: string;
    readonly evidence: readonly AdvisorEvidence[];
    readonly acceptanceContext: unknown;
    readonly implementationDecisions: readonly unknown[];
  },
): AdvisorNote | undefined => {
  if (!Value.Check(implementationAdvisorOutputSchema, value)) {
    throw new AdvisorResultRejectedError("Advisor result rejected: output does not match the required schema.");
  }
  if (value.activityBatch !== evaluation.activityBatch) {
    throw new AdvisorResultRejectedError("Advisor result rejected: output is detached from its activity batch.");
  }
  if (value.kind === "no_note") return undefined;
  if (!implementationAdvisorRuleIds.has(value.ruleId)) {
    throw new AdvisorResultRejectedError("Advisor result rejected: unsupported rule.");
  }
  const rule = implementationAdvisorRules.find((candidate) => candidate.id === value.ruleId);
  if (rule === undefined || !rule.responseClasses.includes(value.responseClass as never)) {
    throw new AdvisorResultRejectedError("Advisor result rejected: unsupported response class.");
  }
  const references = new Set(evaluation.evidence.map((item) => item.reference));
  if (value.evidence.some((reference) => !references.has(reference))) {
    throw new AdvisorResultRejectedError("Advisor result rejected: output cites evidence that the host did not capture.");
  }
  if ([value.problem, value.consequence, value.correction].some((field) => field.trim() === "")) {
    throw new AdvisorResultRejectedError("Advisor result rejected: note fields must not be empty.");
  }
  return {
    ruleId: value.ruleId as ImplementationAdvisorRuleId,
    responseClass: value.responseClass as ImplementationAdvisorResponseClass,
    activityBatch: value.activityBatch,
    evidence: value.evidence,
    problem: value.problem.trim(),
    consequence: value.consequence.trim(),
    correction: value.correction.trim(),
  };
};

export const investigationEvidence = (
  event: AgentSessionEvent,
  activityBatch: string,
  input?: unknown,
): AdvisorEvidence | undefined => {
  if (event.type !== "tool_execution_end" || !readTools.has(event.toolName)) return undefined;
  const eventWithArgs = event as AgentSessionEvent & { readonly args?: unknown };
  return {
    reference: `${activityBatch}:investigation:${event.toolCallId}`,
    activity: event.toolName,
    input: input ?? eventWithArgs.args ?? {},
    result: event.result,
    failed: event.isError,
  };
};

export const turnEvidence = (
  event: TurnEndEvent,
  discoveredContextFiles: ReadonlySet<string> = new Set(),
  cwd = process.cwd(),
): AdvisorEvidence[] => {
  const activityBatch = `turn:${event.turnIndex}`;
  const toolInputs = new Map<string, unknown>();
  const message = event.message as unknown as { readonly content?: readonly unknown[] } | undefined;
  for (const item of message?.content ?? []) {
    const toolCall = item as { readonly type?: string; readonly id?: string; readonly arguments?: unknown };
    if (toolCall.type === "toolCall" && typeof toolCall.id === "string") {
      toolInputs.set(toolCall.id, toolCall.arguments ?? {});
    }
  }
  return event.toolResults.flatMap((toolResult, index) => {
    const input = toolResult as unknown as { readonly toolName: string; readonly toolCallId?: string; readonly isError?: boolean; readonly content?: unknown; readonly input?: unknown; readonly [key: string]: unknown };
    const toolName = input.toolName;
    const toolInput = input.input ?? (input.toolCallId === undefined ? {} : toolInputs.get(input.toolCallId) ?? {});
    const failed = input.isError === true;
    const qualifies = writeTools.has(toolName) || failed ||
      (readTools.has(toolName) && isTargetRepositoryRootContextRead(toolInput as { readonly [key: string]: unknown }, discoveredContextFiles, cwd));
    if (!qualifies) return [];
    return [{
      reference: `${activityBatch}:evidence:${index}`,
      activity: toolName,
      input: toolInput,
      result: input.content,
      failed,
    }];
  });
};

export const createAdvisorActivityScheduler = <T>(
  evaluate: (activities: readonly T[]) => Promise<void>,
) => {
  let active: Promise<void> | undefined;
  let pending: T[] = [];
  const drain = async (): Promise<void> => {
    if (active !== undefined) return active;
    active = (async () => {
      while (pending.length > 0) {
        const batch = pending;
        pending = [];
        await evaluate(batch);
      }
    })();
    try {
      await active;
    } finally {
      active = undefined;
    }
  };
  return {
    async add(activity: T): Promise<void> {
      pending.push(activity);
      await drain();
    },
    get pendingCount(): number { return pending.length; },
    get active(): boolean { return active !== undefined; },
  };
};

const sessionEntryToViewerTranscript = (
  entry: SessionEntry,
): AdvisorViewerTranscriptEntry[] => {
  if (entry.type === "message") {
    const message = entry.message as { readonly role?: string; readonly content?: unknown };
    const kind = message.role === "user"
      ? "user"
      : message.role === "assistant"
        ? "assistant"
        : message.role === "toolResult"
          ? "tool"
          : "system";
    const text = agentMessageText(message);
    return text === ""
      ? []
      : [{ id: entry.id, kind, timestamp: entry.timestamp, text }];
  }
  if (entry.type === "custom_message") {
    const text = contentText(entry.content);
    return text === ""
      ? []
      : [{ id: entry.id, kind: "custom", timestamp: entry.timestamp, text }];
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    const text = entry.summary.trim();
    return text === ""
      ? []
      : [{ id: entry.id, kind: "system", timestamp: entry.timestamp, text }];
  }
  return [];
};

const agentMessageText = (message: { readonly role?: string; readonly content?: unknown }): string =>
  contentText(message.content);

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      if (typeof record["text"] === "string") return record["text"];
      if (record["type"] === "toolCall") {
        const name = typeof record["name"] === "string" ? record["name"] : "tool";
        return `${name} ${safeJson(record["arguments"] ?? {})}`;
      }
      return "";
    })
    .filter((item) => item.trim() !== "")
    .join("\n")
    .trim();
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unavailable]";
  }
};

const boundViewerText = (value: string, maximum: number): string => {
  const text = value.trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 3))}...`;
};

const buildEvaluationPrompt = (evaluation: {
  readonly activityBatch: string;
  readonly evidence: readonly AdvisorEvidence[];
  readonly acceptanceContext: unknown;
  readonly implementationDecisions: readonly unknown[];
}): string =>
  `Review exactly Advisor Activity Batch ${evaluation.activityBatch}.\nAcceptance Context (authoritative approved intent and scope): ${JSON.stringify(evaluation.acceptanceContext)}\nImplementation Decisions (non-authoritative rationale only; not asserted complete or current): ${JSON.stringify(evaluation.implementationDecisions)}\nEvidence for this exact batch: ${JSON.stringify(evaluation.evidence)}\nIf you investigate with read, grep, find, or ls, the host records each successful or failed result as evidence reference ${evaluation.activityBatch}:investigation:<toolCallId>. Use that exact reference when you cite an investigation result.\nEvaluate every supplied rule and call ${NOTE_TOOL} exactly once with kind no_note or note. Bind every result to this exact batch and supplied evidence. Do not claim semantic correctness.`;

const isTargetRepositoryRootContextRead = (
  input: { readonly [key: string]: unknown },
  discoveredContextFiles: ReadonlySet<string>,
  cwd: string,
): boolean => {
  const path = input["path"];
  return typeof path === "string" &&
    discoveredContextFiles.has(resolve(cwd, path)) &&
    dirname(resolve(cwd, path)) === resolve(cwd);
};

const noteFingerprint = (note: AdvisorNote): string =>
  createHash("sha256").update(`${note.ruleId}\n${note.evidence.join("\n")}`).digest("hex");

const sanitizeSessionId = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/gu, "_");

const isAdvisorState = (value: unknown): value is AdvisorState => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record["fingerprints"]) &&
    record["fingerprints"].every((item) => typeof item === "string") &&
    typeof record["failures"] === "number" &&
    typeof record["disabled"] === "boolean" &&
    (record["latestRejectionReason"] === undefined ||
      typeof record["latestRejectionReason"] === "string");
};

