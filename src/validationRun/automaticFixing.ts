export type AutomaticFixingOrigin = "manual" | "afk";

export type AutomaticFixingResolution = {
  readonly enabled: boolean;
  readonly source: "repo_config" | "manual_override";
  readonly command: string | null;
};

export const resolveAutomaticFixing = (input: {
  readonly repoConfigValue?: boolean;
  readonly enabledOverride?: boolean;
  readonly commandOverride?: string;
  readonly origin: AutomaticFixingOrigin;
}): AutomaticFixingResolution => {
  const repoEnabled = input.repoConfigValue ?? true;
  const manualEnabledOverride = input.origin === "manual" ? input.enabledOverride : undefined;
  const commandOverride = input.origin === "manual" ? (input.commandOverride ?? null) : null;
  return {
    enabled: manualEnabledOverride ?? repoEnabled,
    source: manualEnabledOverride === undefined ? "repo_config" : "manual_override",
    command: commandOverride,
  };
};
