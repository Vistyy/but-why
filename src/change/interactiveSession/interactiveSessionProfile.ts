import type { resolveInteractiveSessionAgentProfile } from "../../agent/agentProfiles.js";

export type InteractiveSessionProfileLoadResult =
  | {
      readonly ok: true;
      readonly profile: NonNullable<
        Extract<
          ReturnType<typeof resolveInteractiveSessionAgentProfile>,
          { readonly ok: true }
        >["profile"]
      >;
      readonly globalConfigDirectory: string;
    }
  | {
      readonly ok: false;
      readonly code: "repo_config_invalid" | "agent_profile_invalid";
      readonly message: string;
    };

export type InteractiveSessionProfileLoader = (
  worktreePath: string,
  globalConfigPath: string,
) => InteractiveSessionProfileLoadResult;
