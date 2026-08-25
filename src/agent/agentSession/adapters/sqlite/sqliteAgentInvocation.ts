import type {
  AgentInvocationRecord,
  AgentInvocationSettlement,
  AgentThinking,
} from "../../agentSession.js";

const positiveIntegerMax = 9_007_199_254_740_991;

export type SqliteAgentInvocationRow = {
  readonly id: number;
  readonly agentSessionId: number;
  readonly continuationId: number;
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

export const decodeSqliteAgentInvocation = (
  row: SqliteAgentInvocationRow,
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
    settlementKind:
      row.settlementKind === null ? null : decodeSqliteAgentSettlementKind(row.settlementKind),
    usage,
    continuation: {
      id: row.continuationId,
      agentSessionId: row.agentSessionId,
      harness: decodeHarness(row.harness),
      provider: row.provider,
      model: requiredModel(row.model),
      thinking: row.thinking === null ? null : decodeSqliteAgentThinking(row.thinking),
      transcriptPath: row.transcriptPath,
      unusableReason: row.unusableReason,
    },
  };
};

export const decodeSqliteAgentThinking = (value: string): AgentThinking => {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      throw new Error(`Invalid Agent thinking level: ${value}`);
  }
};

const decodeSqliteAgentSettlementKind = (value: string): AgentInvocationSettlement["kind"] => {
  switch (value) {
    case "returned":
    case "launch_failed":
    case "failed":
    case "return_unknown":
      return value;
    default:
      throw new Error(`Invalid Agent Invocation settlement kind: ${value}`);
  }
};

const requiredModel = (value: string): string => {
  if (value.trim().length === 0) throw new Error("Agent model is blank");
  return value;
};
const decodeHarness = (value: string): "pi" => {
  if (value !== "pi") throw new Error(`Unsupported Agent Harness: ${value}`);
  return value;
};
const requiredToken = (value: number | null): number => {
  if (value === null || !Number.isSafeInteger(value) || value < 0 || value > positiveIntegerMax)
    throw new Error("Agent Invocation token evidence is incomplete");
  return value;
};
