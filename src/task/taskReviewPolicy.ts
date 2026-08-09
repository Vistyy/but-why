import { dirname } from "node:path";

import { Effect, type ParseResult, Schema } from "effect";

import type { AgentProfileResolutionError } from "../agent/agentProfileErrors.js";
import { type ResolvedPiAgentProfile, resolveAgentProfile } from "../agent/agentProfiles.js";
import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import {
  contractDiagnostics,
  formatContractDiagnostics,
} from "../contracts/contractDiagnostics.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import { reviewerFindingCoreSchema } from "../contracts/reviewerFinding.js";
import { ReviewerOutputContractFailed } from "../contracts/reviewerOutputContractFailure.js";
import type { TaskReviewFinding, TaskReviewPolicySnapshot } from "./taskReview.js";

export type TaskReviewPolicyError = AgentProfileResolutionError | GlobalConfigValidationFailed;

export type TaskReviewPolicy = {
  readonly instructions: string;
  readonly instructionsSource: "built_in";
  readonly profile: ResolvedPiAgentProfile;
};

export const resolveTaskReviewPolicy = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
}):
  | { readonly ok: true; readonly policy: TaskReviewPolicy }
  | { readonly ok: false; readonly error: TaskReviewPolicyError } => {
  const resolution = resolveAgentProfile({
    ...(input.globalConfig.defaultAgentProfile === undefined
      ? {}
      : { defaultSelection: input.globalConfig.defaultAgentProfile }),
    ...(input.repoConfig.agentProfiles === undefined
      ? {}
      : { repoProfiles: input.repoConfig.agentProfiles }),
    ...(input.globalConfig.agentProfiles === undefined
      ? {}
      : { globalProfiles: input.globalConfig.agentProfiles }),
    globalConfigDirectory: dirname(input.globalConfigPath),
  });

  if (!resolution.ok) return resolution;
  return {
    ok: true,
    policy: {
      instructions: defaultTaskReviewInstructions,
      instructionsSource: "built_in",
      profile: resolution.resolved,
    },
  };
};

export const taskReviewPolicySnapshot = (policy: TaskReviewPolicy): TaskReviewPolicySnapshot => ({
  version: 1,
  instructions: policy.instructions,
  instructionsSource: policy.instructionsSource,
  profile: {
    agentProfile: policy.profile.agentProfile,
    scope: policy.profile.scope,
    ...(policy.profile.profile.runtimeConfig === undefined
      ? {}
      : {
          runtimeConfig: {
            ...(policy.profile.profile.runtimeConfig.model === undefined
              ? {}
              : { model: policy.profile.profile.runtimeConfig.model }),
            ...(policy.profile.profile.runtimeConfig.thinking === undefined
              ? {}
              : { thinking: policy.profile.profile.runtimeConfig.thinking }),
            ...(policy.profile.profile.runtimeConfig.extensions === undefined
              ? {}
              : { extensions: policy.profile.profile.runtimeConfig.extensions }),
            ...(policy.profile.profile.runtimeConfig.skills === undefined
              ? {}
              : { skills: policy.profile.profile.runtimeConfig.skills }),
            ...(policy.profile.profile.runtimeConfig.tools === undefined
              ? {}
              : { tools: policy.profile.profile.runtimeConfig.tools }),
            ...(policy.profile.profile.runtimeConfig.contextFileDiscovery === undefined
              ? {}
              : {
                  contextFileDiscovery: policy.profile.profile.runtimeConfig.contextFileDiscovery,
                }),
          },
        }),
  },
});

const taskReviewFindingSchema = Schema.Struct({
  ...reviewerFindingCoreSchema.fields,
});

const taskReviewOutputSchema = Schema.Struct({
  findings: Schema.Array(taskReviewFindingSchema),
});

export type TaskReviewReviewerOutput = Schema.Schema.Type<typeof taskReviewOutputSchema>;

export const decodeTaskReviewReviewerOutput = (input: {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
}): Effect.Effect<TaskReviewReviewerOutput, ParseResult.ParseError> =>
  Schema.decodeUnknown(taskReviewOutputSchema, { onExcessProperty: "error" })(input.output);

export const decodeTaskReviewRuntimeOutput = (input: {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
}): Effect.Effect<TaskReviewReviewerOutput, ReviewerOutputContractFailed> =>
  decodeTaskReviewReviewerOutput(input).pipe(
    Effect.mapError((error) => {
      const diagnostics = contractDiagnostics(error, input.output);
      return new ReviewerOutputContractFailed({
        operationName: "decode_task_reviewer_output",
        reviewer: input.reviewer,
        attempts: input.attempts,
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      });
    }),
  );

export const reviewerOutputToFindings = (
  reviewId: string,
  output: TaskReviewReviewerOutput,
): readonly Omit<TaskReviewFinding, "createdAt">[] =>
  output.findings.map((finding, index) => ({
    id: `${reviewId}-task-review-F${index + 1}`,
    reviewId,
    title: finding.title,
    description: finding.description,
    evidence: finding.evidence,
    files: finding.files,
  }));

const defaultTaskReviewInstructions = [
  "You are the Task Reviewer for one unlinked New Task proposal.",
  "Review the exact presented Task Context and direct Task Dependencies against repository evidence in the disposable workspace.",
  "Own the judgment of whether this New Task should be approved and move to Todo.",
  "",
  "Approve the proposal only when every condition holds:",
  "- The proposal delivers one bounded supported result: a completed state distinguishable from the prior supported state, independently acceptable progress toward approved intent, and implementable, reviewable, and verifiable coherently.",
  "- Acceptance criteria are behavior-based and separate from verification mechanisms.",
  "- The Task Verification Contract is complete: it identifies Material Risks, required Verification Claims, required Evidence, Escalation conditions, and explicit exclusions, and the required evidence is proportionate to the Material Risks.",
  "- The required evidence establishes every required Verification Claim, and each durable evidence case identifies the distinct regression failure, why retained or one-time evidence is insufficient, why the selected seam can establish the claim, and why maintenance cost is proportionate.",
  "- Every direct Task Dependency satisfies the strict Task Dependency definition: the dependent Task cannot be implemented or verified until the prerequisite Task is Done. Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.",
  "- The proposal does not require unsupported concepts, a different Work Route, or out-of-scope behavior.",
  "- No approved requirement is omitted, replaced, deferred, or reduced.",
  "",
  "Report a Finding when any condition fails or the proposal is otherwise not ready for approval.",
  "Do not expand or contract approved intent, require optional improvement, or judge reviewer judgment quality.",
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the repository. The disposable workspace and Task Review base are authoritative.",
  "Return exactly one JSON object inside the required XML tag with a findings array.",
  "Each Finding must include title, description, evidence, and files.",
].join("\n");
