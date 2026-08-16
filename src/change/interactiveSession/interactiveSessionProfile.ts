import type { resolveInteractiveSessionAgentProfile } from "../../agent/agentProfiles.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";

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
      readonly code: "agent_profile_invalid";
      readonly message: string;
    };

export type InteractiveSessionProfileLoader = (
  repoConfig: RepoConfig,
  worktreePath: string,
  globalConfigPath: string,
) => InteractiveSessionProfileLoadResult;
