import { createHash } from "node:crypto";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { implementationAdvisorRules, type ImplementationAdvisorRuleId } from "./rules.js";

export const NOTE_TOOL = "implementation_advice";
export const implementationAdvisorToolNames = ["read", "grep", "find", "ls"] as const;
const LEDGER_ENTRY = "but-why.implementation-advisor.ledger";
const qualifyingTools = new Set(["bash", "edit", "write"]);
const readTools = new Set(["read", "grep", "find", "ls"]);
const ruleIds = new Set(implementationAdvisorRules.map((rule) => rule.id));

export type Evidence = { readonly activity: string; readonly reference: string; readonly input: unknown; readonly result: unknown; readonly failed: boolean };
type LedgerItem = { readonly rule: string; readonly batch: number; readonly evidenceFingerprint: string; readonly outcome: "note" | "none" | "failure"; readonly failures: number; readonly timestamp: string };
type Note = { readonly ruleId: ImplementationAdvisorRuleId; readonly message: string; readonly evidence: readonly string[]; readonly activityBatch: number };

export default function implementationAdvisor(pi: ExtensionAPI): void {
  const configuredModel = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL"];
  if (configuredModel === undefined || configuredModel.trim() === "") return;
  const modelSetting = configuredModel;
  const thinking = process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_THINKING"];
  let batch = 0;
  let pending: Evidence[] = [];
  let running = false;
  let disabled = false;
  let failures = 0;
  const emitted = new Map<string, number>();
  const ledger: LedgerItem[] = [];
  let nested: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let currentResult: Note | undefined;
  let currentBatch = 0;
  let terminated = false;
  let currentEvidence: readonly Evidence[] = [];
  let rerunScheduled = false;

  const appendLedger = (item: LedgerItem, context: ExtensionContext): void => {
    ledger.push(item);
    pi.appendEntry(LEDGER_ENTRY, item);
    void context;
  };

  pi.on("session_start", (_event, context) => {
    for (const entry of context.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== LEDGER_ENTRY || !isLedger(entry.data)) continue;
      ledger.push(entry.data);
      if (entry.data.outcome === "note") emitted.set(`${entry.data.rule}:${entry.data.evidenceFingerprint}`, (emitted.get(`${entry.data.rule}:${entry.data.evidenceFingerprint}`) ?? 0) + 1);
      failures = entry.data.outcome === "failure" ? entry.data.failures : 0;
      if (advisorDisabledAfterFailures(failures)) disabled = true;
    }
  });

  pi.on("tool_result", (event) => {
    if (disabled) return;
    const qualifies = shouldEvaluateActivity(event.toolName, event.input);
    if (!qualifies) return;
    const reference = `${event.toolName}:${String(event.toolCallId)}`;
    pending.push({ activity: event.toolName, reference, input: event.input, result: event.content, failed: event.isError });
  });

  const handleSettled = async (context: ExtensionContext): Promise<void> => {
    if (disabled || pending.length === 0) return;
    if (running) {
      rerunScheduled = true;
      return;
    }
    const evidence = pending;
    pending = [];
    const activityBatch = ++batch;
    currentBatch = activityBatch;
    currentEvidence = evidence;
    running = true;
    try {
      const note = await evaluate(evidence, activityBatch, context);
      failures = 0;
      if (note !== undefined && shouldEmit(note, emitted)) {
        emitted.set(`${note.ruleId}:${fingerprint(note.evidence)}`, (emitted.get(`${note.ruleId}:${fingerprint(note.evidence)}`) ?? 0) + 1);
        appendLedger({ rule: note.ruleId, batch: note.activityBatch, evidenceFingerprint: fingerprint(note.evidence), outcome: "note", failures: 0, timestamp: new Date().toISOString() }, context);
        const message = `Implementation Advisor note (activity batch ${note.activityBatch}, rule ${note.ruleId}): ${note.message}\nEvidence: ${note.evidence.join(", ")}`;
        pi.sendMessage({ customType: "but-why.implementation-advisor.note", content: message, display: true, details: { ruleId: note.ruleId, activityBatch: note.activityBatch } }, { triggerTurn: false, deliverAs: context.isIdle() ? "nextTurn" : "followUp" });
      } else {
        appendLedger({ rule: note?.ruleId ?? "none", batch: activityBatch, evidenceFingerprint: fingerprint(evidence.map((item) => item.reference)), outcome: "none", failures: 0, timestamp: new Date().toISOString() }, context);
      }
    } catch (error) {
      failures += 1;
      appendLedger({ rule: "none", batch: activityBatch, evidenceFingerprint: fingerprint(evidence.map((item) => item.reference)), outcome: "failure", failures, timestamp: new Date().toISOString() }, context);
      if (failures === 1) context.ui.notify("Implementation Advisor failed open and will retry on the next qualifying activity.", "warning");
      if (advisorDisabledAfterFailures(failures)) { disabled = true; context.ui.notify("Implementation Advisor disabled after three consecutive failures.", "warning"); }
      void error;
    } finally {
      running = false;
      if ((pending.length > 0 || rerunScheduled) && !disabled) {
        rerunScheduled = false;
        queueMicrotask(() => void handleSettled(context));
      }
    }
  };

  pi.on("agent_settled", (_event, context) => {
    void handleSettled(context);
  });

  async function evaluate(evidence: readonly Evidence[], activityBatch: number, context: ExtensionContext): Promise<Note | undefined> {
    if (nested === undefined) {
      const runtime = await ModelRuntime.create();
      const [provider, ...modelParts] = modelSetting.split("/");
      const model = runtime.getModel(provider ?? "", modelParts.join("/"));
      if (model === undefined) throw new Error("Configured Implementation Advisor model is unavailable.");
      const advisorAgentDir = process.env["PI_CODING_AGENT_DIR"] ?? `${process.env["HOME"] ?? "~"}/.pi/agent`;
      const advisorSessionDir = join(process.env["PI_CODING_AGENT_SESSION_DIR"] ?? join(advisorAgentDir, "sessions"), "implementation-advisor");
      const loader = new DefaultResourceLoader({ cwd: context.cwd, agentDir: advisorAgentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
      await loader.reload();
      nested = (await createAgentSession({ cwd: context.cwd, model, ...(thinking === undefined ? {} : { thinkingLevel: thinking as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" }), tools: ["read", "grep", "find", "ls", NOTE_TOOL], resourceLoader: loader, sessionManager: SessionManager.continueRecent(context.cwd, advisorSessionDir), customTools: [{ name: NOTE_TOOL, label: "Implementation advice", description: "Return zero or one grounded note.", parameters: Type.Object({ ruleId: Type.String(), message: Type.String(), evidence: Type.Array(Type.String()), activityBatch: Type.Integer() }), execute: async (_id, value, _signal, _update, toolContext) => {
        const candidate = value as { readonly ruleId: string; readonly message: string; readonly evidence: readonly string[]; readonly activityBatch: number };
        if (!terminated && candidate.message.trim() !== "" && ruleIds.has(candidate.ruleId as ImplementationAdvisorRuleId) && candidate.activityBatch === currentBatch && candidate.evidence.every((item) => currentEvidence.some((entry) => entry.reference === item))) currentResult = { ruleId: candidate.ruleId as ImplementationAdvisorRuleId, message: candidate.message, evidence: candidate.evidence, activityBatch: candidate.activityBatch };
        terminated = true;
        toolContext.abort();
        return { content: [{ type: "text", text: "Result recorded." }], details: {} };
      } }] })).session;
    }
    currentResult = undefined;
    terminated = false;
    try {
      await nested.prompt(`Review activity batch ${activityBatch}. Accepted implementation context: ${process.env["BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT"] ?? "not supplied"}. Evidence, including inputs and results: ${JSON.stringify(evidence)}. Rules (priority order): ${JSON.stringify(implementationAdvisorRules)}. Apply thresholds exactly. If and only if one grounded rule applies, call ${NOTE_TOOL} with a note bound to this batch and exact evidence references. Otherwise do not call the tool. Do not claim semantic correctness.`);
    } catch (error) {
      if (currentResult === undefined) throw error;
    }
    return currentResult;
  }

}

export const shouldEvaluateActivity = (toolName: string, input: Record<string, unknown>): boolean =>
  qualifyingTools.has(toolName) || (readTools.has(toolName) && isAuthorityRead(input));

export const validateAdvisorNote = (value: { readonly ruleId: string; readonly message: string; readonly evidence: readonly string[]; readonly activityBatch: number }, batch: number, evidence: readonly Evidence[]): Note | undefined =>
  value.message.trim() !== "" && ruleIds.has(value.ruleId as ImplementationAdvisorRuleId) && value.activityBatch === batch && value.evidence.length > 0 && value.evidence.every((item) => evidence.some((candidate) => candidate.reference === item))
    ? { ruleId: value.ruleId as ImplementationAdvisorRuleId, message: value.message, evidence: value.evidence, activityBatch: value.activityBatch }
    : undefined;

export const advisorDisabledAfterFailures = (failures: number): boolean => failures >= 3;

export const createAdvisorActivityScheduler = <T>(evaluate: (batch: number, activity: readonly T[]) => Promise<void>, deliver: (batch: number) => void) => {
  let active = false;
  let nextBatch = 0;
  let pending: T[] = [];
  let scheduled = false;
  const settle = async (): Promise<void> => {
    if (active || pending.length === 0) return;
    active = true;
    const activity = pending;
    pending = [];
    const batch = ++nextBatch;
    try {
      await evaluate(batch, activity);
      deliver(batch);
    } finally {
      active = false;
      if (pending.length > 0 && !scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          void settle();
        });
      }
    }
  };
  return {
    add(activity: T): void { pending.push(activity); },
    settle,
    get pendingCount(): number { return pending.length; },
    get active(): boolean { return active; },
  };
};

const isAuthorityRead = (input: Record<string, unknown>): boolean => /AGENTS\.md|CONTEXT\.md|CONTEXT-MAP\.md|VERIFICATION\.md|docs\/adr|docs\/architecture|docs\/tooling/u.test(JSON.stringify(input));
const fingerprint = (values: readonly string[]): string => createHash("sha256").update(values.join("\n")).digest("hex");
const shouldEmit = (note: Note, emitted: ReadonlyMap<string, number>): boolean => {
  const key = `${note.ruleId}:${fingerprint(note.evidence)}`;
  const count = emitted.get(key) ?? 0;
  const ruleCount = [...emitted.entries()].filter(([entry]) => entry.startsWith(`${note.ruleId}:`)).reduce((sum, [, value]) => sum + value, 0);
  return note.evidence.length > 0 && count === 0 && ruleCount < 3;
};
const isLedger = (value: unknown): value is LedgerItem => typeof value === "object" && value !== null && typeof (value as LedgerItem).rule === "string" && typeof (value as LedgerItem).batch === "number" && typeof (value as LedgerItem).evidenceFingerprint === "string" && ["note", "none", "failure"].includes((value as LedgerItem).outcome);
