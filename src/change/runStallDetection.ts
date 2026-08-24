import { tmpdir } from "node:os";

import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import type { ResolvedPiAgentProfile } from "../agent/agentProfiles.js";
import type {
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../agent/agentSession/agentSession.js";
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
import type { StallDetectionProfile } from "./stallDetectionConfig.js";

const stallDetectionInstructions = [
  "You are the Stall Detector for a linked Change.",
  "The serialized Acceptance Context is authoritative for the accepted outcome.",
  'Return exactly one JSON object with decision "continue" or "stop" and a brief reason.',
  "Return continue unless the unresolved trajectory provides observable Finding evidence that an attempted correction preserved the defect, replaced it with an equivalent or broader defect, or exposed a missing Operator decision.",
  "Equivalent means that earlier and later Findings describe failure of the same accepted outcome with a materially equivalent observable consequence despite a different mechanism.",
  "Broader means that a later Finding explicitly attributes to the correction a concrete consequence that includes the earlier failed outcome and affects additional protected state or operations, or crosses an explicit authority prohibition while correcting the earlier outcome.",
  "Finding count, severity, shared files, terminology, technical area, or topic similarity alone is insufficient.",
  "Ambiguity requires continue.",
  "A stop reason must identify the accepted outcome, earlier Finding, attempted correction evidenced by the trajectory, later Finding, and preserved or expanded observable consequence.",
  "A missing-decision stop must identify the specific undecided choice, why current Acceptance Context does not decide it, and why implementation cannot continue safely without Operator authority.",
].join("\n");

const assessmentSchema = Schema.Struct({
  decision: Schema.Literal("continue", "stop"),
  reason: Schema.String.pipe(Schema.filter((value) => value.trim().length > 0)),
});

export type StallDetectionService = {
  readonly assess: (input: {
    readonly changeId: string;
    readonly validationRunId: number;
    readonly configuration: StallDetectionProfile;
    readonly newlyCompleted: boolean;
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
      if (!assessmentInput.newlyCompleted) return { attempted: false } as const;
      const source = yield* input.persistence.getAssessmentInput(
        assessmentInput.changeId,
        assessmentInput.validationRunId,
      );
      if (source === undefined || source.qualifyingRuns.length < 3) {
        return { attempted: false } as const;
      }

      const linkInvocation: AgentSessionSqlLink = (_sql: SqlClient.SqlClient, _invocationId) =>
        Effect.void;
      const profile = assessorProfile(assessmentInput.configuration);
      const execution = yield* executeAgentSession<StallDetectionAssessment>({
        configuration: {
          harness: "pi",
          provider: null,
          model: assessmentInput.configuration.model,
          thinking: assessmentInput.configuration.thinking ?? null,
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
        return {
          attempted: true,
          diagnostic: {
            code: "stall_detection_unavailable",
            message: `Stall Detection could not complete: ${execution.result.failure.message}`,
          },
        } as const;
      }
      const record = yield* input.persistence.record({
        assessment: execution.result.report,
        agentSessionId: execution.evidence.agentSessionId,
        validationRunId: assessmentInput.validationRunId,
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
    "Assess only the serialized Acceptance Context and Findings trajectory below.",
    "Do not infer Finding classifications or inspect any Candidate, repository, transcript, tool, skill, or filesystem.",
    encodeReviewerWireValue(input),
  ].join("\n\n");

const assessorProfile = (profile: StallDetectionProfile): ResolvedPiAgentProfile => ({
  agentProfile: profile.agentProfile,
  scope: profile.scope,
  profile: {
    agentRuntime: "pi",
    runtimeConfig: {
      model: profile.model,
      ...(profile.thinking === null ? {} : { thinking: profile.thinking }),
      extensions: [],
      skills: [],
      tools: [],
      contextFileDiscovery: false,
    },
  },
});
