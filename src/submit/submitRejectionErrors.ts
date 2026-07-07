import { Data } from "effect";

export class RepoConfigValidationFailed extends Data.TaggedError("RepoConfigValidationFailed")<{
  readonly path?: string;
  readonly message: string;
}> {}

export class GlobalConfigValidationFailed extends Data.TaggedError("GlobalConfigValidationFailed")<{
  readonly path?: string;
  readonly message: string;
}> {}

export class MissingReviewerProfile extends Data.TaggedError("MissingReviewerProfile")<{
  readonly profileName: string;
}> {}

export class InvalidReviewerConfig extends Data.TaggedError("InvalidReviewerConfig")<{
  readonly profileName?: string;
  readonly message: string;
}> {}

export class InvalidSandboxModeFromConfig extends Data.TaggedError("InvalidSandboxModeFromConfig")<{
  readonly sandboxMode: string;
  readonly message: string;
}> {}

export type SubmitRejectionError =
  | RepoConfigValidationFailed
  | GlobalConfigValidationFailed
  | MissingReviewerProfile
  | InvalidReviewerConfig
  | InvalidSandboxModeFromConfig;
