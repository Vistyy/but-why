import { Data } from "effect";

export class MissingAgentProfile extends Data.TaggedError("MissingAgentProfile")<{
  readonly profileName?: string;
  readonly scope?: "repo" | "global";
  readonly selection: "explicit" | "default";
}> {}

export class UnsupportedAgentRuntime extends Data.TaggedError("UnsupportedAgentRuntime")<{
  readonly profileName: string;
  readonly scope?: "repo" | "global";
  readonly agentRuntime: string;
}> {}

export class MissingAgentModel extends Data.TaggedError("MissingAgentModel")<{
  readonly profileName: string;
  readonly scope?: "repo" | "global";
  readonly agentRuntime: string;
}> {}

export class MissingAgentProfileResource extends Data.TaggedError("MissingAgentProfileResource")<{
  readonly profileName: string;
  readonly scope: "repo" | "global";
  readonly resourceType: "extension" | "skill";
  readonly path: string;
  readonly message: string;
}> {}

export type AgentProfileResolutionError =
  | MissingAgentProfile
  | UnsupportedAgentRuntime
  | MissingAgentModel;
