import { isAbsolute, relative, resolve, sep } from "node:path";

import { Cause, Clock, Data, Effect, Option } from "effect";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../contracts/repositoryStorageError.js";
import type { ResolvedPiAgentProfile } from "../agentProfiles.js";
import { findUniquePiSessionTranscript } from "../piSessionTranscript.js";
import type { ReviewerAgentResult, ReviewerAgentRuntime } from "../reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../reviewerExecution.js";
import type { TokenUsage } from "../tokenUsage.js";
import type {
  AgentInvocationRecord,
  AgentInvocationSettlementKind,
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "./agentSession.js";

class TranscriptDiscoveryFailed extends Data.TaggedError("TranscriptDiscoveryFailed")<{
  readonly cause: unknown;
}> {}

export type AgentExecutionEvidence = {
  readonly agentSessionId: number;
  readonly invocations: readonly AgentInvocationRecord[];
  readonly continuationId: number;
};

export type ExecuteAgentSessionInput<Output, DomainError = never, DomainRequirements = never> = {
  readonly agentSessionId?: number;
  readonly configuration: AgentSessionConfiguration;
  readonly agentPersistence: AgentSessionPersistence;
  readonly linkInvocation: AgentSessionSqlLink;
  readonly reviewerRuntime: ReviewerAgentRuntime<Output>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly decodeOutput: (
    output: unknown,
    invocation: number,
  ) => ReturnType<Parameters<ReviewerAgentRuntime<Output>["review"]>[0]["decodeOutput"]>;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly continuationPrompt: string;
  readonly commandCwd: string;
  readonly resourceRoot: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly reviewer: string;
  readonly sessionStorageRoot: string;
  readonly agentEnvironment?: Parameters<
    ReviewerAgentRuntime<Output>["review"]
  >[0]["agentEnvironment"];
  readonly afterInvocation?: (input: {
    readonly result: ReviewerAgentResult<Output>;
    readonly invocationNumber: number;
  }) => Effect.Effect<ReviewerAgentResult<Output>, DomainError, DomainRequirements>;
  readonly settleDomain?: (input: {
    readonly invocationId: number;
    readonly result: ReviewerAgentResult<Output>;
    readonly invocationNumber: number;
    readonly evidence: AgentExecutionEvidence;
  }) => Effect.Effect<AgentSessionSqlLink | undefined, DomainError, DomainRequirements>;
};

export type ExecuteAgentSessionResult<Output> = {
  readonly result: ReviewerAgentResult<Output>;
  readonly evidence: AgentExecutionEvidence;
};

export const executeAgentSession = <Output, DomainError = never, DomainRequirements = never>(
  input: ExecuteAgentSessionInput<Output, DomainError, DomainRequirements>,
): Effect.Effect<
  ExecuteAgentSessionResult<Output>,
  RepositoryStorageError | DomainError,
  DomainRequirements
> =>
  Effect.gen(function* () {
    let prompt = input.prompt;
    let resumeSession: string | undefined;
    let resumeSessionFilePath: string | undefined;
    const invocationEvidence: AgentInvocationRecord[] = [];
    let sessionId = input.agentSessionId;
    let continuationId = 0;
    let invocationNumber = 1;

    while (true) {
      const dispatch = yield* input.agentPersistence.beginInvocation({
        ...(sessionId === undefined ? {} : { agentSessionId: sessionId }),
        configuration: input.configuration,
        createdAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        linkInvocation: input.linkInvocation,
      });
      if (!dispatch.ok) {
        return yield* new RepositoryPersistedDataInvalid({
          operationName: "dispatch Agent Invocation",
          cause: new Error("An Agent Session already has an unsettled Invocation"),
        });
      }
      sessionId = dispatch.dispatch.agentSessionId;
      continuationId = dispatch.dispatch.continuation.id;
      resumeSession = dispatch.dispatch.resumed ? dispatch.dispatch.piSessionId : undefined;
      resumeSessionFilePath =
        dispatch.dispatch.resumed && dispatch.dispatch.continuation.transcriptPath !== null
          ? resolve(input.sessionStorageRoot, dispatch.dispatch.continuation.transcriptPath)
          : undefined;

      const reviewExit = yield* Effect.exit(
        input.reviewerRuntime.review({
          reviewerExecutor: input.reviewerExecutor,
          reviewer: input.reviewer,
          decodeOutput: (output) => input.decodeOutput(output, invocationNumber),
          systemPrompt: input.systemPrompt,
          prompt: dispatch.dispatch.resumed
            ? invocationNumber === 1
              ? input.continuationPrompt
              : prompt
            : input.prompt,
          profile: input.profile,
          commandCwd: input.commandCwd,
          resourceRoot: input.resourceRoot,
          ...(input.agentEnvironment === undefined
            ? {}
            : { agentEnvironment: input.agentEnvironment }),
          sessionStorageRoot: input.sessionStorageRoot,
          sessionId: dispatch.dispatch.piSessionId,
          ...(resumeSession === undefined ? {} : { resumeSession }),
          ...(resumeSessionFilePath === undefined ? {} : { resumeSessionFilePath }),
        }),
      );
      const interrupted =
        reviewExit._tag === "Failure" && Cause.isInterruptedOnly(reviewExit.cause);
      const interruptedSessionFilePath =
        interrupted && resumeSessionFilePath === undefined
          ? Option.getOrUndefined(
              yield* Effect.option(
                Effect.try({
                  try: () =>
                    findUniquePiSessionTranscript(
                      input.sessionStorageRoot,
                      dispatch.dispatch.piSessionId,
                    ),
                  catch: (cause) => new TranscriptDiscoveryFailed({ cause }),
                }),
              ),
            )
          : resumeSessionFilePath;
      const result: ReviewerAgentResult<Output> =
        reviewExit._tag === "Success"
          ? reviewExit.value
          : {
              ok: false,
              failure: {
                kind: "process_execution",
                operationName: interrupted
                  ? "agent_invocation_interrupted"
                  : "agent_invocation_failed",
                message: interrupted
                  ? "Agent Invocation was interrupted."
                  : "Agent Invocation failed.",
                sessionUsability: "unknown",
                ...(interrupted ? { sessionReference: dispatch.dispatch.piSessionId } : {}),
                ...(interrupted && interruptedSessionFilePath !== undefined
                  ? { sessionFilePath: interruptedSessionFilePath }
                  : {}),
              },
              sessionUsability: "unknown",
              attempts: 1,
              stdout: "",
              ...(interrupted ? { sessionReference: dispatch.dispatch.piSessionId } : {}),
              ...(interrupted && interruptedSessionFilePath !== undefined
                ? { sessionFilePath: interruptedSessionFilePath }
                : {}),
            };
      const settledResult =
        input.afterInvocation === undefined
          ? result
          : yield* input.afterInvocation({ result, invocationNumber });
      const settlement = settlementFor(
        settledResult,
        input.sessionStorageRoot,
        interrupted ? "return_unknown" : undefined,
        new Date(yield* Clock.currentTimeMillis).toISOString(),
      );
      const invocationEvidenceRecord: AgentInvocationRecord = {
        ...dispatch.dispatch.invocation,
        settledAt: settlement.settledAt,
        settlementKind: settlement.kind,
        usage: settlement.usage ?? null,
        continuation: {
          ...dispatch.dispatch.continuation,
          ...(settlement.transcriptPath === undefined
            ? {}
            : { transcriptPath: settlement.transcriptPath }),
          ...(settlement.unusableReason === undefined
            ? {}
            : { unusableReason: settlement.unusableReason }),
        },
      };
      const shouldRetry =
        !settledResult.ok &&
        settledResult.failure.kind === "output_contract" &&
        settledResult.sessionReference !== undefined &&
        invocationNumber < 3;
      const evidence: AgentExecutionEvidence = {
        agentSessionId: sessionId,
        continuationId,
        invocations: [...invocationEvidence, invocationEvidenceRecord],
      };
      const settleDomain =
        !shouldRetry && input.settleDomain !== undefined
          ? yield* input.settleDomain({
              invocationId: dispatch.dispatch.invocation.id,
              result: settledResult,
              invocationNumber,
              evidence,
            })
          : undefined;
      yield* Effect.uninterruptible(
        settleDomain === undefined
          ? input.agentPersistence.settleInvocation({
              invocationId: dispatch.dispatch.invocation.id,
              continuationId,
              settlement,
            })
          : input.agentPersistence.settleInvocation({
              invocationId: dispatch.dispatch.invocation.id,
              continuationId,
              settlement,
              settleDomain,
            }),
      );
      invocationEvidence.push(invocationEvidenceRecord);

      if (settledResult.ok || !shouldRetry) {
        return {
          result: settledResult,
          evidence: {
            agentSessionId: sessionId,
            continuationId,
            invocations: invocationEvidence,
          },
        };
      }
      prompt = settledResult.failure.correctionPrompt ?? settledResult.failure.message;
      invocationNumber += 1;
    }
  });

const settlementFor = <Output>(
  result: ReviewerAgentResult<Output>,
  sessionStorageRoot: string,
  forcedKind: AgentInvocationSettlementKind | undefined,
  settledAt: string,
): {
  readonly settledAt: string;
  readonly kind: AgentInvocationSettlementKind;
  readonly usage?: TokenUsage;
  readonly transcriptPath?: string | null;
  readonly unusableReason?: string | null;
} => {
  const transcriptPath = safeTranscriptPath(sessionStorageRoot, result.sessionFilePath);
  if (result.ok) {
    return {
      settledAt,
      kind: forcedKind ?? "returned",
      ...(result.invocationUsage?.[0] === undefined || result.invocationUsage[0] === null
        ? {}
        : { usage: result.invocationUsage[0] }),
      transcriptPath,
      ...(transcriptPath === null ? { unusableReason: "transcript_capture_unavailable" } : {}),
    };
  }
  return {
    settledAt,
    kind:
      forcedKind ??
      (result.failure.kind === "output_contract"
        ? "returned"
        : result.failure.kind === "process_execution" &&
            transcriptPath === null &&
            result.sessionReference === undefined
          ? "launch_failed"
          : "failed"),
    ...(result.invocationUsage?.[0] === undefined || result.invocationUsage[0] === null
      ? {}
      : { usage: result.invocationUsage[0] }),
    transcriptPath,
    ...(result.sessionUsability === "unusable" || transcriptPath === null
      ? { unusableReason: result.failure.message }
      : {}),
  };
};

const safeTranscriptPath = (root: string, path: string | undefined): string | null => {
  if (path === undefined) return null;
  const candidate = relative(root, path);
  return isAbsolute(candidate) ||
    candidate === "" ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`)
    ? null
    : candidate;
};
