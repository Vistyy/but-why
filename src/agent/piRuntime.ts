import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { PiRuntimeConfig } from "../contracts/agentConfig.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import { MissingAgentProfileResource } from "./agentProfileErrors.js";
import { shellQuote } from "./agentEnvironment.js";

export type PiRuntimeResourceScope = "repo" | "global";

export type PiRuntimeResourceContext = {
  readonly scope: PiRuntimeResourceScope;
  readonly repoRoot: string;
  readonly globalConfigDirectory: string | undefined;
};

export const validatePiAgentProfileResources = (
  profile: ResolvedPiAgentProfile,
  resourceRoot: string,
): { readonly ok: true } | { readonly ok: false; readonly error: MissingAgentProfileResource } => {
  const context: PiRuntimeResourceContext = {
    scope: profile.scope,
    repoRoot: resourceRoot,
    globalConfigDirectory: profile.globalConfigDirectory,
  };
  const resources = [
    ...(profile.profile.runtimeConfig?.extensions ?? []).map((source) => ({
      resourceType: "extension" as const,
      source,
    })),
    ...(profile.profile.runtimeConfig?.skills ?? []).map((source) => ({
      resourceType: "skill" as const,
      source,
    })),
  ];

  for (const resource of resources) {
    const path = resolveLocalPiResource(resource.source, context);
    if (path !== undefined && !existsSync(path)) {
      return {
        ok: false,
        error: new MissingAgentProfileResource({
          profileName: profile.agentProfile,
          scope: profile.scope,
          resourceType: resource.resourceType,
          path,
          message: `Agent Profile "${profile.agentProfile}" in ${profile.scope} scope has a missing ${resource.resourceType} resource at resolved path "${path}".`,
        }),
      };
    }
  }

  return { ok: true };
};

export const piResourceFlags = (
  runtimeConfig: PiRuntimeConfig | undefined,
  context: PiRuntimeResourceContext,
  options: { readonly reviewerHygiene?: boolean } = {},
): string => {
  const flags: string[] = [];
  if (options.reviewerHygiene === true) flags.push("--no-prompt-templates", "--no-themes");

  if (runtimeConfig?.extensions !== undefined) {
    flags.push("--no-extensions");
    for (const extension of runtimeConfig.extensions) {
      flags.push("--extension", shellQuote(resolvePiResource(extension, context)));
    }
  }

  if (runtimeConfig?.skills !== undefined) {
    flags.push("--no-skills");
    for (const skill of runtimeConfig.skills) {
      flags.push("--skill", shellQuote(resolvePiResource(skill, context)));
    }
  }

  if (runtimeConfig?.tools !== undefined) {
    flags.push("--tools", runtimeConfig.tools.length === 0 ? "''" : runtimeConfig.tools.join(","));
  }

  if (runtimeConfig?.contextFileDiscovery === false) flags.push("--no-context-files");

  return flags.join(" ");
};

const resolveLocalPiResource = (
  source: string,
  context: PiRuntimeResourceContext,
): string | undefined => {
  if (isPiPackageSource(source)) return undefined;
  if (source.startsWith("~/")) return join(homedir(), source.slice(2));
  return resolvePiResource(source, context);
};

const resolvePiResource = (source: string, context: PiRuntimeResourceContext): string => {
  if (context.scope === "global") {
    if (source.startsWith("~/")) return source;
    if (isAbsolute(source) || isPiPackageSource(source)) return source;
    return resolve(context.globalConfigDirectory ?? context.repoRoot, source);
  }

  if (isAbsolute(source)) return source;
  return resolve(context.repoRoot, source);
};

const isPiPackageSource = (source: string): boolean =>
  /^(?:npm|git|github|https?|ssh):/u.test(source);
