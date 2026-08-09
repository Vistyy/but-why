import { Data } from "effect";

import type { ReviewerOutputContractFailed } from "../contracts/reviewerOutputContractFailure.js";

export class SandcastleToolingFailed extends Data.TaggedError("SandcastleToolingFailed")<{
  readonly operationName: string;
  readonly message: string;
}> {}

export type ReviewerExecutionFailure = SandcastleToolingFailed | ReviewerOutputContractFailed;
