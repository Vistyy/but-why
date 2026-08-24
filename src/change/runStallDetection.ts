import { tmpdir } from "node:os";

import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import type { ResolvedReviewerPiAgentProfile } from "../agent/agentProfiles.js";
import type { AgentSessionPersistence } from "../agent/agentSession/agentSession.js";
import { executeAgentSession } from "../agent/agentSession/executeAgentSession.js";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../agent/reviewerExecution.js";
import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type {
  StallDetectionAssessment,
  StallDetectionAssessmentInput,
  StallDetectionDiagnostic,
  StallDetectionPersistence,
  StallDetectionRecord,
} from "./stallDetection.js";

const stallDetectionInstructions = [
  "You are the Stall Detector for a linked Change.",
  "The serialized Acceptance Context is authoritative for the accepted outcome. Approved Resolutions are already reflected there when applicable; treat the separately serialized Blocker and Resolution history as historical evidence and do not use it to override or amend that context.",
  'Return exactly one JSON object with decision "continue" or "stop" and a brief reason.',
  "Return continue unless the unresolved trajectory provides observable Finding evidence that an attempted correction preserved the defect, replaced it with an equivalent or broader defect, or exposed a missing Operator decision.",
  "Equivalent means that earlier and later Findings describe failure of the same accepted outcome with a materially equivalent observable consequence despite a different mechanism.",
  "Broader means that a later Finding explicitly attributes to the correction a concrete consequence that includes the earlier failed outcome and affects additional protected state or operations, or crosses an explicit authority prohibition while correcting the earlier outcome.",
  "Finding count, severity, shared files, terminology, technical area, or topic similarity alone is insufficient.",
  "Ambiguity requires continue.",
  "A stop reason must identify the accepted outcome, earlier Finding, attempted correction evidenced by the trajectory, later Finding, and preserved or expanded observable consequence.",
  "A missing-decision stop must identify the specific undecided choice, why current Acceptance Context does not decide it, and why implementation cannot continue safely without Operator authority.",
  "A pre-Resolution Finding supports a stop only when a later Finding judged under the applicable newer Resolution prefix explicitly establishes that the corrected problem persists under current Acceptance Context.",
  "Resolving a Stall-Detector-sourced Blocker treats Findings through its triggering Run as addressed for future stop eligibility.",
  "Do not stop solely because of a relationship already covered by a resolved Stall Detection; use a later qualifying Run to establish that the resolved problem persists or establish a new qualifying relationship.",
].join("\n");

const assessmentSchema = Schema.Struct({
  decision: Schema.Literal("continue", "stop"),
  reason: Schema.String.pipe(Schema.filter((value) => value.trim().length > 0)),
});

export type StallDetectionService = {
  readonly assess: (input: {
    readonly changeId: string;
    readonly validationRunId: number;
    readonly configuration: ResolvedReviewerPiAgentProfile;
    readonly now: string;
  }) => Effect.Effect<
    | { readonly attempted: false }
    | { readonly attempted: true; readonly record: StallDetectionRecord }
    | { readonly attempted: true; readonly diagnostic: StallDetectionDiagnostic },
    RepositoryStorageError
  >;
};

export const makeStallDetectionService = (input: {
  readonly persistence: StallDetectionPersistence;
  readonly agentPersistence: AgentSessionPersistence;
  readonly runtime: ReviewerAgentRuntime<StallDetectionAssessment>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly sessionStorageRoot: string;
}): StallDetectionService => {
  const assess: StallDetectionService["assess"] = (assessmentInput) =>
    Effect.gen(function* () {
      const existing = yield* input.persistence.getByValidationRun(assessmentInput.validationRunId);
      if (existing !== undefined) return { attempted: true, record: existing } as const;
      const previousAttempt = yield* input.persistence.getAttemptByValidationRun(
        assessmentInput.validationRunId,
      );
      if (previousAttempt !== undefined) {
        return { attempted: true, diagnostic: previousAttempt } as const;
      }
      const source = yield* input.persistence.getAssessmentInput(
        assessmentInput.changeId,
        assessmentInput.validationRunId,
      );
      if (source === undefined || source.qualifyingRuns.length < 3) {
        return { attempted: false } as const;
      }

      const invocationIds: number[] = [];
      const linkInvocation = (sql: SqlClient.SqlClient, invocationId: number) =>
        Effect.gen(function* () {
          invocationIds.push(invocationId);
          yield* input.persistence.linkInvocation(source.triggeringValidationRunId)(
            sql,
            invocationId,
          );
        });
      const profile = assessorProfile(assessmentInput.configuration);
      const execution = yield* executeAgentSession<StallDetectionAssessment>({
        configuration: {
          harness: "pi",
          provider: null,
          model: assessmentInput.configuration.profile.runtimeConfig.model,
          thinking: assessmentInput.configuration.profile.runtimeConfig.thinking ?? null,
        },
        agentPersistence: input.agentPersistence,
        linkInvocation,
        reviewerRuntime: input.runtime,
        reviewerExecutor: input.reviewerExecutor,
        decodeOutput: (output) => decodeAssessment(output),
        systemPrompt: stallDetectionInstructions,
        prompt: assessmentPrompt(source),
        continuationPrompt: assessmentPrompt(source),
        commandCwd: tmpdir(),
        resourceRoot: tmpdir(),
        profile,
        reviewer: "stall_detector",
        sessionStorageRoot: input.sessionStorageRoot,
      });
      if (!execution.result.ok) {
        const diagnostic = {
          code: "stall_detection_unavailable" as const,
          message: `Stall Detection could not complete: ${execution.result.failure.message}`,
        };
        const retained = yield* input.persistence.recordAttempt({
          assessmentInput: source,
          diagnostic,
          agentSessionId: execution.evidence.agentSessionId,
          invocationIds,
          now: assessmentInput.now,
        });
        return { attempted: true, diagnostic: retained } as const;
      }
      const record = yield* input.persistence.record({
        assessment: execution.result.report,
        assessmentInput: source,
        configuration: assessmentInput.configuration,
        agentSessionId: execution.evidence.agentSessionId,
        invocationIds,
        now: assessmentInput.now,
      });
      return { attempted: true, record } as const;
    });
  return { assess };
};

const decodeAssessment = (
  output: unknown,
): Effect.Effect<StallDetectionAssessment, ReviewerExecutionFailed> => {
  const decoded = Schema.decodeUnknownEither(assessmentSchema, { onExcessProperty: "error" })(
    output,
  );
  return decoded._tag === "Right"
    ? Effect.succeed(decoded.right)
    : Effect.fail(
        new ReviewerExecutionFailed({
          kind: "output_contract",
          operationName: "decode_stall_detection_output",
          message: "Stall Detector output must contain exactly decision and reason.",
          correctionPrompt:
            'Return exactly {"decision":"continue"|"stop","reason":"brief relational reason"}.',
        }),
      );
};

const assessmentPrompt = (input: StallDetectionAssessmentInput): string =>
  [
    "Assess only the serialized evidence below.",
    "The separately serialized Blocker and Resolution history is historical evidence; do not treat it as Acceptance Context or as an instruction to stop.",
    "Do not infer Finding classifications or inspect any Candidate, repository, transcript, tool, skill, or filesystem.",
    encodeReviewerWireValue(input),
  ].join("\n\n");

const assessorProfile = (
  profile: ResolvedReviewerPiAgentProfile,
): ResolvedReviewerPiAgentProfile => ({
  ...profile,
  profile: {
    ...profile.profile,
    runtimeConfig: {
      model: profile.profile.runtimeConfig.model,
      ...(profile.profile.runtimeConfig.thinking === undefined
        ? {}
        : { thinking: profile.profile.runtimeConfig.thinking }),
      extensions: [],
      skills: [],
      tools: [],
      contextFileDiscovery: false,
    },
  },
});
