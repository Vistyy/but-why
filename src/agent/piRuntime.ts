import { isAbsolute, resolve } from "node:path";

import type { PiRuntimeConfig } from "../contracts/agentConfig.js";
import { shellQuote } from "./agentEnvironment.js";

export type PiRuntimeResourceScope = "repo" | "global";

export type PiRuntimeResourceContext = {
  readonly scope: PiRuntimeResourceScope;
  readonly repoRoot: string;
  readonly globalConfigDirectory: string | undefined;
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
