import { dirname, join } from "node:path";

import { Data, type Effect, type ParseResult, Schema } from "effect";

import type { AgentProfileResolutionError } from "../agent/agentProfileErrors.js";
import { type ResolvedPiAgentProfile, resolveAgentProfile } from "../agent/agentProfiles.js";
import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import { reviewerFindingCoreSchema } from "../contracts/reviewerFinding.js";
import { type InstructionsReadResult, readInstructionsFile } from "../init/instructionsFile.js";
import type { TaskReviewFinding, TaskReviewPolicySnapshot } from "./taskReview.js";

// fallow-ignore-next-line unused-export -- public Task Reviewer policy error
export class TaskReviewInstructionsInvalid extends Data.TaggedError(
  "TaskReviewInstructionsInvalid",
)<{
  readonly message: string;
}> {}

export type TaskReviewPolicyError =
  | AgentProfileResolutionError
  | GlobalConfigValidationFailed
  | TaskReviewInstructionsInvalid;

export type TaskReviewPolicy = {
  readonly instructions: string;
  readonly instructionsSource: "repo" | "global" | "built_in";
  readonly profile: ResolvedPiAgentProfile;
};

export const resolveTaskReviewPolicy = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
  readonly readRepoInstructionsFile?: (
    repoRoot: string,
    instructionsFile: string,
  ) => InstructionsReadResult;
}):
  | { readonly ok: true; readonly policy: TaskReviewPolicy }
  | { readonly ok: false; readonly error: TaskReviewPolicyError } => {
  const resolution = resolveAgentProfile({
    ...(input.repoConfig.review?.task?.agentProfile === undefined
      ? {}
      : { repoSelection: input.repoConfig.review.task.agentProfile }),
    ...(input.globalConfig.review?.task?.agentProfile === undefined
      ? {}
      : { globalSelection: input.globalConfig.review.task.agentProfile }),
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
  const instructions = resolveInstructions(input);
  if (!instructions.ok) return instructions;

  return {
    ok: true,
    policy: {
      instructions: instructions.instructions,
      instructionsSource: instructions.instructionsSource,
      profile: resolution.resolved,
    },
  };
};

const resolveInstructions = (input: {
  readonly repoConfig: RepoConfig;
  readonly globalConfig: GlobalConfig;
  readonly repoRoot: string;
  readonly globalConfigPath: string;
  readonly readRepoInstructionsFile?: (
    repoRoot: string,
    instructionsFile: string,
  ) => InstructionsReadResult;
}):
  | (Pick<TaskReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: TaskReviewInstructionsInvalid } => {
  const repoInstructionsFile = input.repoConfig.review?.task?.instructionsFile;
  if (repoInstructionsFile !== undefined) {
    const result =
      input.readRepoInstructionsFile === undefined
        ? readInstructionsFile(join(input.repoRoot, repoInstructionsFile))
        : input.readRepoInstructionsFile(input.repoRoot, repoInstructionsFile);
    return result.ok
      ? { ok: true, instructions: result.instructions, instructionsSource: "repo" }
      : { ok: false, error: new TaskReviewInstructionsInvalid({ message: result.message }) };
  }

  const globalInstructionsFile = input.globalConfig.review?.task?.instructionsFile;
  if (globalInstructionsFile !== undefined) {
    return readInstructions(
      join(dirname(input.globalConfigPath), globalInstructionsFile),
      "global",
    );
  }

  return {
    ok: true,
    instructions: defaultTaskReviewInstructions,
    instructionsSource: "built_in",
  };
};

const readInstructions = (
  path: string,
  instructionsSource: "repo" | "global",
):
  | (Pick<TaskReviewPolicy, "instructions" | "instructionsSource"> & { readonly ok: true })
  | { readonly ok: false; readonly error: TaskReviewInstructionsInvalid } => {
  const result = readInstructionsFile(path);
  return result.ok
    ? { ok: true, instructions: result.instructions, instructionsSource }
    : { ok: false, error: new TaskReviewInstructionsInvalid({ message: result.message }) };
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
