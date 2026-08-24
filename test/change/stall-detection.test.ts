import type * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ResolvedReviewerPiAgentProfile } from "../../src/agent/agentProfiles.js";
import type {
  AgentDispatchResult,
  AgentSessionPersistence,
} from "../../src/agent/agentSession/agentSession.js";
import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import { makeStallDetectionService } from "../../src/change/runStallDetection.js";
import type {
  StallDetectionAssessment,
  StallDetectionAssessmentInput,
  StallDetectionPersistence,
  StallDetectionRecord,
} from "../../src/change/stallDetection.js";

const profile: ResolvedReviewerPiAgentProfile = {
  agentProfile: "stall-detector",
  scope: "global",
  profile: {
    agentRuntime: "pi",
    runtimeConfig: {
      model: "test/model",
      thinking: "low",
      extensions: ["extension"],
      skills: ["skill"],
      tools: ["tool"],
      contextFileDiscovery: true,
    },
  },
};

const assessmentInput: StallDetectionAssessmentInput = {
  changeId: "BY-C1",
  triggeringValidationRunId: 3,
  acceptanceContext: { version: 1, title: "Intent", description: "Deliver it." },
  qualifyingRuns: [1, 2, 3].map((validationRunId) => ({
    validationRunId,
    acceptanceContext: { version: 1, title: "Intent", description: "Deliver it." },
    resolutionPrefix: [],
    findings: [
      {
        validationRunId,
        phase: "acceptance_review",
        producer: "acceptance",
        title: "Finding",
        description: "The accepted outcome is not established.",
        evidence: "Evidence",
        files: [],
        artifactRefs: [],
      },
    ],
  })),
  blockerHistory: { blockers: [], resolutions: [], active: null },
};

const invocation = {
  id: 17,
  continuationId: 18,
  createdAt: "2026-06-30T12:00:00.000Z",
  settledAt: null,
  settlementKind: null,
  usage: null,
} as const;

it.effect("runs a bounded serialized Stall Detection with a fresh restricted Pi session", () =>
  Effect.gen(function* () {
    let linkedInvocation = 0;
    let observedInput: StallDetectionAssessmentInput | undefined;
    let observedProfile: ResolvedReviewerPiAgentProfile | undefined;
    const agentPersistence: AgentSessionPersistence = {
      beginInvocation: (input) =>
        Effect.gen(function* () {
          yield* input
            .linkInvocation(null as unknown as SqlClient.SqlClient, invocation.id)
            .pipe(Effect.catchAll(() => Effect.void));
          return {
            ok: true,
            dispatch: {
              agentSessionId: 19,
              continuation: {
                id: invocation.continuationId,
                agentSessionId: 19,
                harness: "pi",
                provider: null,
                model: input.configuration.model,
                thinking: input.configuration.thinking ?? null,
                transcriptPath: null,
                unusableReason: null,
              },
              invocation,
              resumed: false,
              piSessionId: "fresh-session",
            },
          } satisfies AgentDispatchResult;
        }),
      settleInvocation: () => Effect.void,
      readInvocationHistory: () => Effect.succeed([]),
    };
    const runtime: ReviewerAgentRuntime<StallDetectionAssessment> = {
      review: (input): Effect.Effect<ReviewerAgentResult<StallDetectionAssessment>> => {
        const restrictedProfile = input.profile as ResolvedReviewerPiAgentProfile;
        observedProfile = restrictedProfile;
        expect(input.sessionId).toBe("fresh-session");
        expect(input.resumeSession).toBeUndefined();
        expect(input.agentEnvironment).toBeUndefined();
        expect(restrictedProfile.profile.runtimeConfig.extensions).toEqual([]);
        expect(restrictedProfile.profile.runtimeConfig.skills).toEqual([]);
        expect(restrictedProfile.profile.runtimeConfig.tools).toEqual([]);
        expect(restrictedProfile.profile.runtimeConfig.contextFileDiscovery).toBe(false);
        expect(input.systemPrompt).toContain("Stall Detector");
        expect(input.prompt).toContain("serialized evidence");
        return Effect.succeed({
          ok: true,
          report: { decision: "continue", reason: "Ambiguous." },
          attempts: 1,
          stdout: "{}",
        });
      },
    };
    const persistence: StallDetectionPersistence = {
      getAttemptByValidationRun: () => Effect.succeed(undefined),
      getAssessmentInput: () => Effect.succeed(assessmentInput),
      getByValidationRun: () => Effect.succeed(undefined),
      recordAttempt: () =>
        Effect.die("A completed Stall Detection should not record an unavailable attempt."),
      listForChange: () => Effect.succeed([]),
      record: (input) => {
        linkedInvocation = input.invocationIds[0] ?? 0;
        observedInput = input.assessmentInput;
        return Effect.succeed({
          id: 1,
          changeId: input.assessmentInput.changeId,
          validationRunId: input.assessmentInput.triggeringValidationRunId,
          agentSessionId: input.agentSessionId,
          decision: input.assessment.decision,
          reason: input.assessment.reason,
          configuration: input.configuration,
          input: input.assessmentInput,
          invocations: [invocation],
          blockerId: null,
          createdAt: input.now,
        } satisfies StallDetectionRecord);
      },
    };
    const reviewerExecutor: ReviewerProcessExecutor = {
      execute: () => Effect.die("The fake runtime does not launch a process."),
    };
    const service = makeStallDetectionService({
      persistence,
      agentPersistence,
      runtime,
      reviewerExecutor,
      sessionStorageRoot: "/sessions",
    });

    const result = yield* service.assess({
      changeId: assessmentInput.changeId,
      validationRunId: assessmentInput.triggeringValidationRunId,
      configuration: profile,
      now: "2026-06-30T12:00:00.000Z",
    });

    expect(result).toMatchObject({ attempted: true, record: { decision: "continue" } });
    expect(linkedInvocation).toBe(invocation.id);
    expect(observedInput).toEqual(assessmentInput);
    expect(observedProfile?.profile.runtimeConfig.extensions).toEqual([]);
  }),
);
