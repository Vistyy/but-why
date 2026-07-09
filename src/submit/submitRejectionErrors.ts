import { Data } from "effect";

import {
  GlobalConfigValidationFailed,
  RepoConfigValidationFailed,
} from "../contracts/configErrors.js";

export { GlobalConfigValidationFailed, RepoConfigValidationFailed };

export class MissingReviewerProfile extends Data.TaggedError("MissingReviewerProfile")<{
  readonly profileName: string;
}> {}

export class InvalidReviewerConfig extends Data.TaggedError("InvalidReviewerConfig")<{
  readonly profileName?: string;
  readonly message: string;
}> {}

export type SubmitRejectionError =
  | RepoConfigValidationFailed
  | GlobalConfigValidationFailed
  | MissingReviewerProfile
  | InvalidReviewerConfig;
