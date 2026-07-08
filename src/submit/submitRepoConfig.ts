import type {
  RepoCheckConfig,
  RepoConfig,
  RepoValidationPrepareConfig,
} from "../init/repoConfig.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import {
  InvalidSandboxModeFromConfig,
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "./submitRejectionErrors.js";

export type SubmitRepoConfig = {
  readonly sandboxMode: ValidationSandboxMode;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
};

export type SubmitPrepareConfig = RepoValidationPrepareConfig & {
  readonly timeoutSeconds: number;
};

export type SubmitCheckConfig = RepoCheckConfig & {
  readonly timeoutSeconds: number;
};

const checkIdPattern = /^[a-z0-9][a-z0-9_-]*$/;
const defaultValidationCommandTimeoutSeconds = 1200;
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

  const prepareValidation = validatePrepare(config.validation?.prepare);

  if (!prepareValidation.ok) {
    return prepareValidation;
  }

  if (config.checks === undefined || config.checks.length === 0) {
    return invalidConfig("Repo config must define at least one check.");
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
      timeoutSeconds: check.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
    });
  }

  return {
    ok: true,
    config: {
      sandboxMode,
      ...(prepareValidation.prepare === undefined ? {} : { prepare: prepareValidation.prepare }),
      checks,
    },
  };
};

const isValidationSandboxMode = (value: string): value is ValidationSandboxMode =>
  sandboxModes.has(value as ValidationSandboxMode);

const validatePrepare = (
  prepare: RepoValidationPrepareConfig | undefined,
):
  | { readonly ok: true; readonly prepare?: SubmitPrepareConfig }
  | { readonly ok: false; readonly error: SubmitRejectionError } => {
  if (prepare === undefined) {
    return { ok: true };
  }

  if (prepare.command.trim().length === 0) {
    return invalidConfig("Prepare command must not be empty.");
  }

  if (prepare.timeoutSeconds !== undefined && !Number.isInteger(prepare.timeoutSeconds)) {
    return invalidConfig("Prepare timeoutSeconds must be a positive integer.");
  }

  if (prepare.timeoutSeconds !== undefined && prepare.timeoutSeconds <= 0) {
    return invalidConfig("Prepare timeoutSeconds must be a positive integer.");
  }

  return {
    ok: true,
    prepare: {
      command: prepare.command,
      timeoutSeconds: prepare.timeoutSeconds ?? defaultValidationCommandTimeoutSeconds,
    },
  };
};

const validateCheck = (
  check: RepoCheckConfig,
  seenCheckIds: ReadonlySet<string>,
): { readonly ok: true } | { readonly ok: false; readonly error: SubmitRejectionError } => {
  if (!checkIdPattern.test(check.id)) {
    return invalidConfig(`Check id is not valid for artifact refs: ${check.id}`);
  }

  if (seenCheckIds.has(check.id)) {
    return invalidConfig(`Duplicate check id: ${check.id}`);
  }

  if (check.command.trim().length === 0) {
    return invalidConfig(`Check command must not be empty: ${check.id}`);
  }

  if (check.timeoutSeconds !== undefined && !Number.isInteger(check.timeoutSeconds)) {
    return invalidConfig(`Check timeoutSeconds must be a positive integer: ${check.id}`);
  }

  if (check.timeoutSeconds !== undefined && check.timeoutSeconds <= 0) {
    return invalidConfig(`Check timeoutSeconds must be a positive integer: ${check.id}`);
  }

  return { ok: true };
};

const invalidConfig = (
  message: string,
): { readonly ok: false; readonly error: SubmitRejectionError } => ({
  ok: false,
  error: new RepoConfigValidationFailed({ path: ".but-why/config.json", message }),
});
