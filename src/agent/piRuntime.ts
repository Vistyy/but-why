import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { PiRuntimeConfig } from "../contracts/agentConfig.js";
import { shellQuote } from "./agentEnvironment.js";
import { MissingAgentProfileResource } from "./agentProfileErrors.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";

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

export const piResourceArgs = (
  runtimeConfig: PiRuntimeConfig | undefined,
  context: PiRuntimeResourceContext,
  options: {
    readonly reviewerHygiene?: boolean;
    readonly trustedExtensions?: readonly string[];
  } = {},
): readonly string[] => {
  const args: string[] = [];
  if (options.reviewerHygiene === true) args.push("--no-prompt-templates", "--no-themes");

  const trustedExtensions = options.trustedExtensions ?? [];
  const configuredExtensions =
    runtimeConfig?.extensions?.map((extension) =>
      canonicalizeExistingPath(resolvePiResource(extension, context)),
    ) ?? [];
  if (runtimeConfig?.extensions !== undefined) args.push("--no-extensions");
  const extensions: string[] = [];
  const seenExtensionPaths = new Set<string>();
  for (const extension of [
    ...configuredExtensions,
    ...trustedExtensions.map(canonicalizeExistingPath),
  ]) {
    if (seenExtensionPaths.has(extension)) continue;
    seenExtensionPaths.add(extension);
    extensions.push(extension);
  }
  for (const extension of extensions) args.push("--extension", extension);

  if (runtimeConfig?.skills !== undefined) {
    args.push("--no-skills");
    for (const skill of runtimeConfig.skills) {
      args.push("--skill", resolvePiResource(skill, context));
    }
  }

  if (runtimeConfig?.tools !== undefined) {
    args.push("--tools", runtimeConfig.tools.join(","));
  }

  if (runtimeConfig?.contextFileDiscovery === false) args.push("--no-context-files");

  return args;
};

export const piResourceFlags = (
  runtimeConfig: PiRuntimeConfig | undefined,
  context: PiRuntimeResourceContext,
  options: {
    readonly reviewerHygiene?: boolean;
    readonly trustedExtensions?: readonly string[];
  } = {},
): string =>
  piResourceArgs(runtimeConfig, context, options)
    .map((argument) => (argument.startsWith("--") ? argument : shellQuote(argument)))
    .join(" ");

const resolveLocalPiResource = (
  source: string,
  context: PiRuntimeResourceContext,
): string | undefined => {
  if (isPiPackageSource(source)) return undefined;
  if (source.startsWith("~/")) return join(homedir(), source.slice(2));
  return resolvePiResource(source, context);
};

export const resolvePiResource = (source: string, context: PiRuntimeResourceContext): string => {
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

const canonicalizeExistingPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
