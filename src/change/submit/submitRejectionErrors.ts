import { Data } from "effect";

import type {
  MissingAgentModel,
  MissingAgentProfile,
  UnsupportedAgentRuntime,
} from "../../agent/agentProfileErrors.js";
import { RepoConfigValidationFailed } from "../../contracts/configErrors.js";
import type { GlobalConfigValidationFailed } from "../../contracts/configErrors.js";

export { RepoConfigValidationFailed };

export class InvalidReviewerConfig extends Data.TaggedError("InvalidReviewerConfig")<{
  readonly profileName?: string;
  readonly message: string;
}> {}

export type SubmitRejectionError =
  | RepoConfigValidationFailed
  | GlobalConfigValidationFailed
  | MissingAgentProfile
  | UnsupportedAgentRuntime
  | MissingAgentModel
  | InvalidReviewerConfig;
