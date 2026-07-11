import { Data } from "effect";

export class MissingAgentProfile extends Data.TaggedError("MissingAgentProfile")<{
  readonly profileName?: string;
  readonly selection: "explicit" | "default";
}> {}

export class UnsupportedAgentRuntime extends Data.TaggedError("UnsupportedAgentRuntime")<{
  readonly profileName: string;
  readonly agentRuntime: string;
}> {}

export class MissingAgentModel extends Data.TaggedError("MissingAgentModel")<{
  readonly profileName: string;
  readonly agentRuntime: string;
}> {}

export type AgentProfileResolutionError =
  | MissingAgentProfile
  | UnsupportedAgentRuntime
  | MissingAgentModel;
