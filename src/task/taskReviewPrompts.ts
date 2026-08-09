import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { TaskReviewProposal } from "./taskReview.js";
import type { TaskReviewPolicy } from "./taskReviewPolicy.js";

const taskReviewerExecutionInstructions = [
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the repository. The disposable workspace and Task Review base are authoritative.",
].join("\n");

export type TaskReviewPromptInput = {
  readonly reviewId: string;
  readonly baseCommit: string;
  readonly proposal: TaskReviewProposal;
  readonly policy: TaskReviewPolicy;
};

export const buildTaskReviewerPrompt = (input: TaskReviewPromptInput): string =>
  [
    input.policy.instructions,
    "",
    taskReviewerExecutionInstructions,
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
    "Direct Task Dependencies (evidence):",
    encodeReviewerWireValue({ dependencies: input.proposal.dependencies }),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, and files.",
  ].join("\n");
