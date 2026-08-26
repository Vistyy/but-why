import type { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { TokenUsage } from "../tokenUsage.js";

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

export type AgentSessionDispatchInput = {
  readonly agentSessionId?: number;
  readonly configuration: AgentSessionConfiguration;
  readonly createdAt: string;
};

export type AgentSessionSettlementInput = {
  readonly invocationId: number;
  readonly continuationId: number;
  readonly settlement: AgentInvocationSettlement;
};

/**
 * A semantic owner journal composes Agent Session persistence with one owner's
 * linkage and settlement data inside the same transaction.
 */
export type AgentSessionJournal<Entry> = {
  readonly beginInvocation: (
    input: AgentSessionDispatchInput & { readonly entry: Entry },
  ) => Effect.Effect<AgentDispatchResult, RepositoryStorageError>;
  readonly settleInvocation: (
    input: AgentSessionSettlementInput & { readonly entry?: Entry },
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type AgentSessionPersistence = {
  readonly beginInvocation: (
    input: AgentSessionDispatchInput,
  ) => Effect.Effect<AgentDispatchResult, RepositoryStorageError>;
  readonly settleInvocation: (
    input: AgentSessionSettlementInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
  readonly readInvocationHistory: (
    agentSessionId: number,
  ) => Effect.Effect<readonly AgentInvocationRecord[], RepositoryStorageError>;
};

export const piSessionIdForContinuation = (continuationId: number): string =>
  `by-agent-${continuationId}`;
