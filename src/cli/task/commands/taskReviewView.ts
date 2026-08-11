import type { PiAgentProfileConfig, PiRuntimeConfig } from "../../../contracts/agentConfig.js";
import type {
  TaskReviewPolicySnapshot,
  TaskReviewPolicySnapshotV2,
  TaskReviewRecord,
} from "../../../task/review/taskReview.js";
import type { TaskReviewIdentityInspection } from "../../../task/review/taskReviewUseCases.js";

export const taskReviewView = (
  review: TaskReviewRecord,
  proposalCurrent?: boolean,
  identity?: TaskReviewIdentityInspection,
) => ({
  id: review.id,
  taskId: review.taskId,
  state: review.state,
  outcome: review.outcome,
  proposal: review.proposal,
  proposalCurrent: proposalCurrent ?? null,
  dependencyEvidence: review.dependencyEvidence,
  policy: taskReviewPolicyView(review.policy),
  reviewBase: { ref: review.baseRef, commit: review.baseCommit },
  workspace: { path: review.workspacePath, cleanup: review.workspaceCleanup },
  ...(identity === undefined ? {} : { identity }),
  findings: review.findings,
  findingCount: review.findings.length,
  toolingFailure: review.toolingFailure,
  recovery: {
    workspaceCleanup: review.workspaceCleanup,
    failedOperation: review.toolingFailure?.operation ?? null,
    nextActions:
      review.state === "running"
        ? [
            "Stop the Task Review process before abandonment.",
            `Run \`by task-review abandon ${review.id} --reason "..."\` after the process stops.`,
          ]
        : [],
  },
  sessions: review.sessions,
  transcripts: review.transcripts,
  abandonReason: review.abandonReason,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});

const taskReviewPolicyView = (policy: TaskReviewPolicySnapshot) =>
  policy.version === 1
    ? policy
    : {
        id: policy.id,
        version: policy.version,
        profile: taskReviewProfileView(policy.profile),
        builtInInstructions: policy.builtInInstructions,
        guidance: policy.guidance,
      };

const taskReviewProfileView = (profile: TaskReviewPolicySnapshotV2["profile"]) => ({
  agentProfile: profile.agentProfile,
  scope: profile.scope,
  profile: piAgentProfileView(profile.profile),
});

const piAgentProfileView = (profile: PiAgentProfileConfig) => ({
  agentRuntime: profile.agentRuntime,
  ...(profile.runtimeConfig === undefined
    ? {}
    : { runtimeConfig: piRuntimeConfigView(profile.runtimeConfig) }),
});

const piRuntimeConfigView = (runtime: PiRuntimeConfig) => ({
  ...(runtime.model === undefined ? {} : { model: runtime.model }),
  ...(runtime.thinking === undefined ? {} : { thinking: runtime.thinking }),
  ...(runtime.extensions === undefined ? {} : { extensions: runtime.extensions }),
  ...(runtime.skills === undefined ? {} : { skills: runtime.skills }),
  ...(runtime.tools === undefined ? {} : { tools: runtime.tools }),
  ...(runtime.contextFileDiscovery === undefined
    ? {}
    : { contextFileDiscovery: runtime.contextFileDiscovery }),
});
