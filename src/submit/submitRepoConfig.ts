import type { RepoCheckConfig, RepoConfig } from "../init/repoConfig.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import {
  InvalidSandboxModeFromConfig,
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "./submitRejectionErrors.js";

export type SubmitRepoConfig = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly checks: readonly SubmitCheckConfig[];
};

export type SubmitCheckConfig = RepoCheckConfig & {
  readonly timeoutSeconds: number;
};

const checkIdPattern = /^[a-z0-9][a-z0-9_-]*$/;
const defaultCheckTimeoutSeconds = 1200;
const sandboxModes = new Set<ValidationSandboxMode>(["none", "docker", "podman"]);

export const submitRepoConfig = (
  config: RepoConfig,
):
  | { readonly ok: true; readonly config: SubmitRepoConfig }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  const sandboxMode = config.validation?.sandbox?.mode ?? "none";

  if (!isValidationSandboxMode(sandboxMode)) {
    return {
      ok: false,
      error: new InvalidSandboxModeFromConfig({
        sandboxMode,
        message: `Unsupported validation sandbox mode: ${sandboxMode}`,
      }),
    };
  }

  if (config.checks === undefined || config.checks.length === 0) {
    return {
      ok: false,
      error: new RepoConfigValidationFailed({
        path: ".but-why/config.json",
        message: "Repo config must define at least one check.",
      }),
    };
  }

  const seenCheckIds = new Set<string>();
  const checks: SubmitCheckConfig[] = [];

  for (const check of config.checks) {
    const validation = validateCheck(check, seenCheckIds);

    if (!validation.ok) {
      return validation;
    }

    seenCheckIds.add(check.id);
    checks.push({
      id: check.id,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? defaultCheckTimeoutSeconds,
    });
  }

  return { ok: true, config: { sandboxMode, checks } };
};

const isValidationSandboxMode = (value: string): value is ValidationSandboxMode =>
  sandboxModes.has(value as ValidationSandboxMode);

const validateCheck = (
  check: RepoCheckConfig,
  seenCheckIds: ReadonlySet<string>,
): { readonly ok: true } | { readonly ok: false; readonly error: SubmitRejectionError } => {
  if (!checkIdPattern.test(check.id)) {
    return invalidCheck(`Check id is not valid for artifact refs: ${check.id}`);
  }

  if (seenCheckIds.has(check.id)) {
    return invalidCheck(`Duplicate check id: ${check.id}`);
  }

  if (check.command.trim().length === 0) {
    return invalidCheck(`Check command must not be empty: ${check.id}`);
  }

  if (check.timeoutSeconds !== undefined && !Number.isInteger(check.timeoutSeconds)) {
    return invalidCheck(`Check timeoutSeconds must be a positive integer: ${check.id}`);
  }

  if (check.timeoutSeconds !== undefined && check.timeoutSeconds <= 0) {
    return invalidCheck(`Check timeoutSeconds must be a positive integer: ${check.id}`);
  }

  return { ok: true };
};

const invalidCheck = (
  message: string,
): { readonly ok: false; readonly error: SubmitRejectionError } => ({
  ok: false,
  error: new RepoConfigValidationFailed({ path: ".but-why/config.json", message }),
});
