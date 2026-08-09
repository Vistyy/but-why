import { dirname } from "node:path";

import { Effect, type ParseResult, Schema } from "effect";

import type { AgentProfileResolutionError } from "../agent/agentProfileErrors.js";
import { type ResolvedPiAgentProfile, resolveAgentProfile } from "../agent/agentProfiles.js";
import { ReviewerExecutionFailed } from "../agent/reviewerAgentRuntime.js";
import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import {
  contractDiagnostics,
  formatContractDiagnostics,
} from "../contracts/contractDiagnostics.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import { reviewerFindingCoreSchema } from "../contracts/reviewerFinding.js";
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

const decodeTaskReviewReviewerOutput = (
  output: unknown,
): Effect.Effect<TaskReviewReviewerOutput, ParseResult.ParseError> =>
  Schema.decodeUnknown(taskReviewOutputSchema, { onExcessProperty: "error" })(output);

export const decodeTaskReviewRuntimeOutput = (
  output: unknown,
): Effect.Effect<TaskReviewReviewerOutput, ReviewerExecutionFailed> =>
  decodeTaskReviewReviewerOutput(output).pipe(
    Effect.mapError((error) => {
      const diagnostics = contractDiagnostics(error, output);
      return new ReviewerExecutionFailed({
        operationName: "decode_task_reviewer_output",
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
        correctionPrompt: [
          "Return a corrected Task Review result that satisfies the output contract.",
          formatContractDiagnostics(diagnostics),
        ].join("\n"),
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
  "Provide one advisory judgment of whether this New Task proposal is ready for direct Task Approval.",
  "",
  "Return no Findings only when the proposal is clear, internally consistent, feasible against the current repository, and ready for the Operator to consider for direct Task Approval.",
  "Every direct Task Dependency must satisfy the strict Task Dependency definition: the dependent Task cannot be implemented or verified until the prerequisite Task is Done. Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.",
  "Use the complete Task Context, including its Task Verification Contract, exactly as presented.",
  "Do not impose a mandatory Task Verification Contract structure, mandatory Review Path, or reviewer-authority policy.",
  "Report a Finding when the proposal conflicts with repository evidence, depends on unsupported behavior, omits information needed to understand its requested outcome, or is otherwise not ready for the Operator to consider for approval.",
  "Do not expand or contract approved intent, require optional improvement, or judge reviewer judgment quality.",
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the repository. The disposable workspace and Task Review base are authoritative.",
  "Return exactly one JSON object inside the required XML tag with a findings array.",
  "Each Finding must include title, description, evidence, and files.",
].join("\n");
