import type { AgentProfileConfig } from "../contracts/agentConfig.js";
import type { SubmitRepoConfig } from "../submit/submitRepoConfig.js";
import type { ValidationSandboxMode } from "../validation/validationWorkspace.js";
import { sha256CanonicalJson } from "./canonicalJson.js";

export type ValidationPolicyCommand = {
  readonly command: string;
  readonly timeoutSeconds: number;
};

export type ValidationPolicyReviewer = {
  readonly role: "acceptance" | "specialist" | "final";
  readonly id: string;
  readonly instructions: string;
  readonly agentRuntime: string;
  readonly agentModel: string | null;
  readonly thinking: string | null;
};

export type ValidationPolicySnapshotV1 = {
  readonly schemaVersion: 1;
  readonly prepare: ValidationPolicyCommand | null;
  readonly checks: readonly (ValidationPolicyCommand & { readonly id: string })[];
  readonly reviewers: readonly ValidationPolicyReviewer[];
  readonly reviewerMode: "sequential" | "parallel" | null;
  readonly sandbox: { readonly mode: ValidationSandboxMode };
  readonly appliedDefaults: {
    readonly commandTimeoutSeconds: number;
    readonly sandboxMode: ValidationSandboxMode;
  };
};

export type ValidationPolicySnapshotResolution = {
  readonly snapshot: ValidationPolicySnapshotV1;
  readonly fingerprint: string;
};

export type SubmitPolicySnapshotResolution =
  | ({ readonly ok: true } & ValidationPolicySnapshotResolution)
  | {
      readonly ok: false;
      readonly code: "reviewer_instructions_unreadable";
      readonly path: string;
    };

export type ResolveValidationPolicyInput = {
  readonly prepare?: { readonly command: string; readonly timeoutSeconds?: number };
  readonly checks: readonly {
    readonly id: string;
    readonly command: string;
    readonly timeoutSeconds?: number;
  }[];
  readonly reviewers?: readonly ValidationPolicyReviewerInput[];
  readonly reviewerMode?: "sequential" | "parallel";
  readonly sandboxMode?: ValidationSandboxMode;
  readonly defaultCommandTimeoutSeconds?: number;
};

export type ValidationPolicyReviewerInput = {
  readonly role: ValidationPolicyReviewer["role"];
  readonly id: string;
  readonly instructions: string;
  readonly agent: AgentProfileConfig;
};

const defaultCommandTimeoutSeconds = 1200;

export const resolveValidationPolicySnapshotFromSubmitConfig = (input: {
  readonly config: SubmitRepoConfig;
  readonly instructionsByPath: Readonly<Record<string, string>>;
}): SubmitPolicySnapshotResolution => {
  const reviewers: ValidationPolicyReviewerInput[] = [];
  const configured = [
    ...(input.config.intentReviewer === undefined
      ? []
      : [{ role: "acceptance" as const, reviewer: input.config.intentReviewer }]),
    ...(input.config.qualityReview?.reviewers ?? []).map((reviewer) => ({
      role: "specialist" as const,
      reviewer,
    })),
  ];
  for (const { role, reviewer } of configured) {
    const instructions = input.instructionsByPath[reviewer.instructionsFile];
    if (instructions === undefined) {
      return {
        ok: false,
        code: "reviewer_instructions_unreadable",
        path: reviewer.instructionsFile,
      };
    }
    reviewers.push({ role, id: reviewer.id, instructions, agent: reviewer });
  }
  const resolved = resolveValidationPolicySnapshot({
    ...(input.config.prepare === undefined ? {} : { prepare: input.config.prepare }),
    checks: input.config.checks,
    reviewers,
    ...(input.config.qualityReview === undefined
      ? {}
      : { reviewerMode: input.config.qualityReview.mode }),
    sandboxMode: input.config.sandboxMode,
  });
  return { ok: true, ...resolved };
};

export const resolveValidationPolicySnapshot = (
  input: ResolveValidationPolicyInput,
): ValidationPolicySnapshotResolution => {
  const commandTimeoutSeconds = input.defaultCommandTimeoutSeconds ?? defaultCommandTimeoutSeconds;
  const sandboxMode = input.sandboxMode ?? "none";
  const snapshot: ValidationPolicySnapshotV1 = {
    schemaVersion: 1,
    prepare:
      input.prepare === undefined
        ? null
        : {
            command: input.prepare.command,
            timeoutSeconds: input.prepare.timeoutSeconds ?? commandTimeoutSeconds,
          },
    checks: input.checks.map((check) => ({
      id: check.id,
      command: check.command,
      timeoutSeconds: check.timeoutSeconds ?? commandTimeoutSeconds,
    })),
    reviewers: (input.reviewers ?? []).map((reviewer) => ({
      role: reviewer.role,
      id: reviewer.id,
      instructions: reviewer.instructions,
      agentRuntime: reviewer.agent.agentRuntime,
      agentModel: reviewer.agent.agentModel ?? null,
      thinking: reviewer.agent.thinking ?? null,
    })),
    reviewerMode: input.reviewerMode ?? null,
    sandbox: { mode: sandboxMode },
    appliedDefaults: { commandTimeoutSeconds, sandboxMode },
  };

  return { snapshot, fingerprint: sha256CanonicalJson(snapshot) };
};
