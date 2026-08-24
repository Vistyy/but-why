import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ResolvedReviewerPiAgentProfile } from "../../src/agent/agentProfiles.js";
import type {
  AgentDispatchResult,
  AgentSessionPersistence,
} from "../../src/agent/agentSession/agentSession.js";
import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import { makeStallDetectionService } from "../../src/change/runStallDetection.js";
import type {
  StallDetectionAssessmentInput,
  StallDetectionPersistence,
  StallDetectionRecord,
} from "../../src/change/stallDetection.js";

const profile = {
  agentProfile: "stall-detector",
  scope: "global" as const,
  model: "test/model",
  thinking: "low" as const,
};

const assessmentInput: StallDetectionAssessmentInput = {
  acceptanceContext: { version: 1, title: "Intent", description: "Deliver it." },
  qualifyingRuns: [1, 2, 3].map(() => ({
    findings: [
      {
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
    let observedInput: StallDetectionAssessmentInput | undefined;
    let observedProfile: ResolvedReviewerPiAgentProfile | undefined;
    const agentPersistence: AgentSessionPersistence = {
      beginInvocation: (input) =>
        Effect.succeed({
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
        } satisfies AgentDispatchResult),
      settleInvocation: () => Effect.void,
      readInvocationHistory: () => Effect.succeed([]),
    };
    const persistence: StallDetectionPersistence = {
      getAssessmentInput: () => Effect.succeed(assessmentInput),
      getByValidationRun: () => Effect.succeed(undefined),
      listForChange: () => Effect.succeed([]),
      record: (input) => {
        observedInput = assessmentInput;
        return Effect.succeed({
          id: 1,
          validationRunId: input.validationRunId,
          agentSessionId: input.agentSessionId,
          decision: input.assessment.decision,
          reason: input.assessment.reason,
          blockerId: null,
        } satisfies StallDetectionRecord);
      },
    };
    const reviewerExecutor: ReviewerProcessExecutor = {
      execute: (input) => {
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
        expect(input.prompt).toContain("Acceptance Context and Findings trajectory");
        expect(input.prompt).not.toContain("validationRunId");
        expect(input.prompt).not.toContain("agentProfile");
        return Effect.succeed({
          stdout:
            '<reviewer-output>{"decision":"continue","reason":"Ambiguous."}</reviewer-output>',
        });
      },
    };
    const service = makeStallDetectionService({
      persistence,
      agentPersistence,
      runtime: piReviewerAgentRuntime,
      reviewerExecutor,
      sessionStorageRoot: "/sessions",
    });

    const result = yield* service.assess({
      changeId: "BY-C1",
      validationRunId: 3,
      configuration: profile,
      newlyCompleted: true,
    });

    expect(result).toMatchObject({ attempted: true, record: { decision: "continue" } });
    expect(observedInput).toEqual(assessmentInput);
    expect(observedProfile?.profile.runtimeConfig.extensions).toEqual([]);
  }),
);
