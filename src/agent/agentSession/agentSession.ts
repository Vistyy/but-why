import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import type { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { TokenUsage } from "../tokenUsage.js";

export const agentHarness = {
  pi: "pi",
} as const;

export type AgentHarness = (typeof agentHarness)[keyof typeof agentHarness];
export type AgentThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AgentSessionConfiguration = {
  readonly harness: "pi";
  readonly provider?: string | null;
  readonly model: string;
  readonly thinking?: AgentThinking | null;
};

export type AgentInvocationSettlementKind =
  | "returned"
  | "launch_failed"
  | "failed"
  | "return_unknown";

export type AgentInvocationSettlement = {
  readonly settledAt: string;
  readonly kind: AgentInvocationSettlementKind;
  readonly usage?: TokenUsage;
  readonly transcriptPath?: string | null;
  readonly unusableReason?: string | null;
};

export type AgentInvocationRecord = {
  readonly id: number;
  readonly continuationId: number;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlementKind: AgentInvocationSettlementKind | null;
  readonly usage: TokenUsage | null;
  readonly continuation?: AgentContinuationRecord;
};

export type AgentContinuationRecord = AgentSessionConfiguration & {
  readonly id: number;
  readonly agentSessionId: number;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

export type AgentDispatch = {
  readonly agentSessionId: number;
  readonly continuation: AgentContinuationRecord;
  readonly invocation: AgentInvocationRecord;
  readonly resumed: boolean;
  readonly piSessionId: string;
};

export type AgentDispatchResult =
  | { readonly ok: true; readonly dispatch: AgentDispatch }
  | { readonly ok: false; readonly code: "concurrent_unsettled_invocation" };

export type AgentSessionSqlLink = (
  sql: SqlClient.SqlClient,
  invocationId: number,
) => Effect.Effect<void, RepositoryStorageError | SqlError>;

export type AgentSessionPersistence = {
  readonly beginInvocation: (input: {
    readonly agentSessionId?: number;
    readonly configuration: AgentSessionConfiguration;
    readonly createdAt: string;
    readonly linkInvocation: AgentSessionSqlLink;
  }) => Effect.Effect<AgentDispatchResult, RepositoryStorageError>;
  readonly settleInvocation: (input: {
    readonly invocationId: number;
    readonly continuationId: number;
    readonly settlement: AgentInvocationSettlement;
    readonly settleDomain?: AgentSessionSqlLink;
  }) => Effect.Effect<void, RepositoryStorageError>;
  readonly readInvocationHistory: (
    agentSessionId: number,
  ) => Effect.Effect<readonly AgentInvocationRecord[], RepositoryStorageError>;
};

export const piSessionIdForContinuation = (continuationId: number): string =>
  `by-agent-${continuationId}`;

export const tokenUsageColumns = (usage: TokenUsage | undefined) => ({
  inputTokens: usage?.inputTokens ?? null,
  cachedInputTokens: usage?.cachedInputTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
  totalTokens: usage?.totalTokens ?? null,
});
