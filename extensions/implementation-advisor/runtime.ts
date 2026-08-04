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
};

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
  let activeTerminated = false;
  let activeInvestigationEvidence: AdvisorEvidence[] = [];
  const investigationInputs = new Map<string, unknown>();
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

  const setFailure = (context: ExtensionContext): void => {
    const failures = state.failures + 1;
    state = { ...state, failures, disabled: failures >= 3 };
    appendState();
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

  const evaluate = async (evaluation: {
    readonly activityBatch: string;
    readonly evidence: readonly AdvisorEvidence[];
    readonly acceptanceContext: unknown;
    readonly implementationDecisions: readonly unknown[];
  }): Promise<AdvisorNote | undefined> => {
    if (nested === undefined) {
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
      nested = (
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
      nested.subscribe((event: AgentSessionEvent) => {
        if (event.type === "tool_execution_start" && readTools.has(event.toolName)) {
          investigationInputs.set(event.toolCallId, event.args);
          return;
        }
        if (activeBatch === undefined) return;
        const evidence = investigationEvidence(
          event,
          activeBatch.activityBatch,
          investigationInputs.get(event.type === "tool_execution_end" ? event.toolCallId : ""),
        );
        if (event.type === "tool_execution_end") investigationInputs.delete(event.toolCallId);
        if (evidence !== undefined) activeInvestigationEvidence.push(evidence);
      });
    }

    activeBatch = evaluation;
    activeResult = undefined;
    activeTerminated = false;
    activeInvestigationEvidence = [];
    try {
      await nested.prompt(buildEvaluationPrompt(evaluation));
    } catch (error) {
      if (activeResult === undefined) throw error;
    }
    const result = activeResult as AdvisorOutput | undefined;
    if (!activeTerminated || result === undefined) {
      throw new Error("Implementation Advisor did not return terminating structured output.");
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
    } catch {
      setFailure(delta.context);
    }
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
        }
        toolContext.abort();
        return { content: [{ type: "text", text: "Structured result recorded." }], details: {} };
      },
    };
  }
};

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
    throw new Error("Implementation Advisor output does not match its schema.");
  }
  if (value.activityBatch !== evaluation.activityBatch) {
    throw new Error("Implementation Advisor output is detached from its activity batch.");
  }
  if (value.kind === "no_note") return undefined;
  if (!implementationAdvisorRuleIds.has(value.ruleId)) {
    throw new Error("Implementation Advisor selected an unsupported rule.");
  }
  const rule = implementationAdvisorRules.find((candidate) => candidate.id === value.ruleId);
  if (rule === undefined || !rule.responseClasses.includes(value.responseClass as never)) {
    throw new Error("Implementation Advisor selected an unsupported response class.");
  }
  const references = new Set(evaluation.evidence.map((item) => item.reference));
  if (value.evidence.some((reference) => !references.has(reference))) {
    throw new Error("Implementation Advisor selected unknown evidence.");
  }
  if ([value.problem, value.consequence, value.correction].some((field) => field.trim() === "")) {
    throw new Error("Implementation Advisor note fields must not be empty.");
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
    typeof record["disabled"] === "boolean";
};

