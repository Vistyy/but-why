import type {
  AgentContinuationRecord,
  AgentInvocationRecord,
  AgentInvocationSettlement,
  AgentSessionConfiguration,
} from "../../agentSession.js";

const positiveIntegerMax = 9_007_199_254_740_991;

export type AgentInvocationPersistenceRow = {
  readonly id: number;
  readonly continuationId: number;
  readonly agentSessionId: number;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly harness: string;
  readonly provider: string | null;
  readonly model: string;
  readonly thinking: string | null;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

export const decodeAgentInvocation = (
  row: AgentInvocationPersistenceRow,
): AgentInvocationRecord => {
  const usagePresent =
    row.inputTokens !== null ||
    row.cachedInputTokens !== null ||
    row.cacheWriteTokens !== null ||
    row.outputTokens !== null ||
    row.totalTokens !== null;
  const usage = usagePresent
    ? {
        inputTokens: requiredToken(row.inputTokens),
        cachedInputTokens: requiredToken(row.cachedInputTokens),
        cacheWriteTokens: requiredToken(row.cacheWriteTokens),
        outputTokens: requiredToken(row.outputTokens),
        totalTokens: requiredToken(row.totalTokens),
      }
    : null;
  return {
    id: row.id,
    continuationId: row.continuationId,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    settlementKind: row.settlementKind === null ? null : decodeSettlementKind(row.settlementKind),
    usage,
    continuation: decodeContinuation(row),
  };
};

const decodeContinuation = (
  row: Pick<
    AgentInvocationPersistenceRow,
    | "continuationId"
    | "agentSessionId"
    | "harness"
    | "provider"
    | "model"
    | "thinking"
    | "transcriptPath"
    | "unusableReason"
  >,
): AgentContinuationRecord => ({
  id: row.continuationId,
  agentSessionId: row.agentSessionId,
  harness: decodeHarness(row.harness),
  provider: row.provider,
  model: requiredModel(row.model),
  thinking: row.thinking === null ? null : decodeThinking(row.thinking),
  transcriptPath: row.transcriptPath,
  unusableReason: row.unusableReason,
});

export const requiredModel = (value: string): string => {
  if (value.trim().length === 0) throw new Error("Agent model is blank");
  return value;
};

export const decodeHarness = (value: string): "pi" => {
  if (value !== "pi") throw new Error(`Unsupported Agent Harness: ${value}`);
  return "pi";
};

export const decodeThinking = (
  value: string,
): NonNullable<AgentSessionConfiguration["thinking"]> => {
  if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(value))
    throw new Error(`Invalid Agent thinking level: ${value}`);
  return value as NonNullable<AgentSessionConfiguration["thinking"]>;
};

const decodeSettlementKind = (value: string): AgentInvocationSettlement["kind"] => {
  if (!["returned", "launch_failed", "failed", "return_unknown"].includes(value))
    throw new Error(`Invalid Agent Invocation settlement kind: ${value}`);
  return value as AgentInvocationSettlement["kind"];
};

const requiredToken = (value: number | null): number => {
  if (value === null || !Number.isSafeInteger(value) || value < 0 || value > positiveIntegerMax)
    throw new Error("Agent Invocation token evidence is incomplete");
  return value;
};
