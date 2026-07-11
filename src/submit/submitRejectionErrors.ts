import { Data } from "effect";

import type {
  MissingAgentModel,
  MissingAgentProfile,
  UnsupportedAgentRuntime,
} from "../agent/agentProfileErrors.js";
import {
  GlobalConfigValidationFailed,
  RepoConfigValidationFailed,
} from "../contracts/configErrors.js";

export { GlobalConfigValidationFailed, RepoConfigValidationFailed };

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
