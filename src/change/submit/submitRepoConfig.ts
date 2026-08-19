import type { RepoCheckConfig, RepoConfig, RepoPrepareConfig } from "../../contracts/repoConfig.js";
import { RepoConfigValidationFailed, type SubmitRejectionError } from "./submitRejectionErrors.js";

export type SubmitRepoConfig = {
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly [SubmitCheckConfig, ...SubmitCheckConfig[]];
};

export type SubmitPrepareConfig = RepoPrepareConfig & {
  readonly timeoutSeconds: number;
};

export type SubmitCheckConfig = RepoCheckConfig & {
  readonly timeoutSeconds: number;
};

const defaultValidationCommandTimeoutSeconds = 1200;

export const submitRepoConfig = (
  config: RepoConfig,
):
  | { readonly ok: true; readonly config: SubmitRepoConfig }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const configuredChecks = config.validation?.checks;

  if (configuredChecks === undefined || configuredChecks.length === 0) {
    return invalidConfig("Repo config must define at least one validation.checks entry.");
  }

  const seenCheckIds = new Set<string>();
  const checks: SubmitCheckConfig[] = [];

  for (const check of configuredChecks) {
    if (seenCheckIds.has(check.id)) {
      return invalidConfig(`Duplicate check id: ${check.id}`);
    }

    seenCheckIds.add(check.id);
    checks.push({
      id: check.id,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
    });
  }

  const prepare = config.prepare;

  return {
    ok: true,
    config: {
      ...(prepare === undefined
        ? {}
        : {
            prepare: {
              command: prepare.command,
              timeoutSeconds: prepare.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
            },
          }),
      checks: checks as [SubmitCheckConfig, ...SubmitCheckConfig[]],
    },
  };
};

const invalidConfig = (
  message: string,
): { readonly ok: false; readonly error: SubmitRejectionError } => ({
  ok: false,
  error: new RepoConfigValidationFailed({
    path: ".but-why/config.json",
    diagnostics: [],
    message,
  }),
});
