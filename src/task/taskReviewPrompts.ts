import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { TaskReviewDependencyEvidence, TaskReviewProposal } from "./taskReview.js";
import type { TaskReviewPolicy } from "./taskReviewPolicy.js";

export type TaskReviewPromptInput = {
  readonly reviewId: string;
  readonly baseCommit: string;
  readonly proposal: TaskReviewProposal;
  readonly dependencyEvidence: readonly TaskReviewDependencyEvidence[];
  readonly policy: TaskReviewPolicy;
};

export const buildTaskReviewerPrompt = (input: TaskReviewPromptInput): string =>
  [
    input.policy.instructions,
    "",
    "Task Review identity:",
    encodeReviewerWireValue({ reviewId: input.reviewId, baseCommit: input.baseCommit }),
    "",
    "Task Context (authoritative proposal under review):",
    encodeReviewerWireValue({
      title: input.proposal.title,
      description: input.proposal.description,
    }),
    "",
    "Canonical direct Task Dependency IDs (authoritative proposal identity):",
    encodeReviewerWireValue({ dependencyIds: input.proposal.dependencyIds }),
    "",
    "Point-in-time direct Task Dependency evidence:",
    encodeReviewerWireValue({ dependencies: input.dependencyEvidence }),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, and files.",
  ].join("\n");
