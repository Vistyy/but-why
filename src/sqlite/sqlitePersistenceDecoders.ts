import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../agent/agentProfiles.js";
import type { CandidateValidationPolicySnapshot } from "../change/candidateValidation/candidateValidationRunStore.js";
import type {
  ChangeCleanup,
  ChangeCloseReason,
  ChangePrepareDefinition,
  ChangePrepareFailure,
  ChangeState,
} from "../change/change.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import { isTaskState, type TaskState } from "../task/lifecycle.js";

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const get = (record: RecordValue, key: string): unknown => record[key];

export const parseSqliteJson = (encoded: string, description: string): unknown => {
  try {
    return JSON.parse(encoded) as unknown;
  } catch (cause) {
    throw new Error(`Stored ${description} is not valid JSON`, { cause });
  }
};

export const requiredString = (value: unknown, description: string): string => {
  if (typeof value !== "string") throw new Error(`Stored ${description} is not a string`);
  return value;
};

export const requiredInteger = (value: unknown, description: string): number => {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new Error(`Stored ${description} is not an integer`);
  }
  return number;
};

export const requiredPositiveInteger = (value: unknown, description: string): number => {
  const number = requiredInteger(value, description);
  if (number <= 0) throw new Error(`Stored ${description} is not positive`);
  return number;
};

export const decodeLatestResolvedBlockerId = (
  rows: readonly {
    readonly id: unknown;
    readonly resolvedAt: unknown;
    readonly sequence: unknown;
  }[],
): string | null => {
  const decoded = rows.map((row) => ({
    id: requiredString(row.id, "Implementation Blocker ID"),
    resolvedAt: requiredString(row.resolvedAt, "Implementation Blocker resolution timestamp"),
    sequence: requiredPositiveInteger(row.sequence, "Implementation Blocker sequence"),
  }));
  return (
    [...decoded].sort((left, right) =>
      left.resolvedAt < right.resolvedAt
        ? 1
        : left.resolvedAt > right.resolvedAt
          ? -1
          : right.sequence - left.sequence,
    )[0]?.id ?? null
  );
};

const optionalString = (value: unknown, description: string): string | null =>
  value === null ? null : requiredString(value, description);

const nonBlankString = (value: unknown, description: string): string => {
  const string = requiredString(value, description);
  if (string.trim().length === 0) throw new Error(`Stored ${description} is blank`);
  return string;
};

const configName = (value: unknown, description: string): string => {
  const name = nonBlankString(value, description);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    throw new Error(`Stored ${description} is not a valid configuration name`);
  return name;
};

const checkId = (value: unknown, description: string): string => {
  const id = nonBlankString(value, description);
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id))
    throw new Error(`Stored ${description} is not a valid check ID`);
  return id;
};

const repoRelativePath = (value: unknown, description: string): string => {
  const path = nonBlankString(value, description);
  if (
    path === "." ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes(":") ||
    path.split(/[\\/]/u).includes("..") ||
    path.includes("\\")
  )
    throw new Error(`Stored ${description} is not a repository-relative path`);
  return path;
};

export const decodeTaskState = (value: unknown): TaskState => {
  const state = requiredString(value, "Task lifecycle state");
  if (!isTaskState(state)) throw new Error("Stored Task lifecycle state is invalid");
  return state;
};

export const decodeChangeState = (value: unknown): ChangeState => {
  const state = requiredString(value, "Change lifecycle state");
  if (state !== "open" && state !== "closed")
    throw new Error("Stored Change lifecycle state is invalid");
  return state;
};

export const decodeChangeCloseReason = (value: unknown): ChangeCloseReason | null => {
  if (value === null) return null;
  const reason = requiredString(value, "Change close reason");
  if (reason !== "completed" && reason !== "cancelled")
    throw new Error("Stored Change close reason is invalid");
  return reason;
};

export const decodeChangeLifecycleConsistency = (
  state: ChangeState,
  closeReason: ChangeCloseReason | null,
  closedAt: unknown,
): string | null => {
  const closed = optionalString(closedAt, "Change closed timestamp");
  if (state === "open" && (closeReason !== null || closed !== null))
    throw new Error("Open Change has closed lifecycle fields");
  if (state === "closed" && (closeReason === null || closed === null))
    throw new Error("Closed Change is missing lifecycle fields");
  return closed;
};

export const decodeChangeCleanup = (state: unknown, blockingReason: unknown): ChangeCleanup => {
  const decodedState = requiredString(state, "Change cleanup state");
  if (decodedState !== "complete" && decodedState !== "pending")
    throw new Error("Stored Change cleanup state is invalid");
  return {
    state: decodedState,
    blockingReason: optionalString(blockingReason, "Change cleanup blocking reason"),
  };
};

export const decodeChangePrepare = (
  command: unknown,
  timeoutSeconds: unknown,
): ChangePrepareDefinition | null => {
  if (command === null && timeoutSeconds === null) return null;
  if (command === null || timeoutSeconds === null)
    throw new Error("Stored Change preparation command and timeout are incomplete");
  return {
    command: requiredString(command, "Change preparation command"),
    timeoutSeconds: requiredPositiveInteger(timeoutSeconds, "Change preparation timeout"),
  };
};

export const decodeTaskLifecycleConsistency = (
  state: TaskState,
  cancelReason: unknown,
): string | null => {
  const reason = optionalString(cancelReason, "Task cancel reason");
  if (state === "cancelled" && reason === null)
    throw new Error("Cancelled Task is missing its cancel reason");
  if (state !== "cancelled" && reason !== null)
    throw new Error("Non-cancelled Task has a cancel reason");
  return reason;
};

export const decodeAcceptanceContextValue = (value: unknown) => {
  if (
    !isRecord(value) ||
    get(value, "version") !== 1 ||
    typeof get(value, "title") !== "string" ||
    typeof get(value, "description") !== "string" ||
    (get(value, "comments") !== undefined &&
      (!Array.isArray(get(value, "comments")) ||
        !(get(value, "comments") as unknown[]).every((comment) => typeof comment === "string")))
  ) {
    throw new Error("Stored Acceptance Context Snapshot is invalid");
  }
  const resolutions = get(value, "resolutions");
  if (
    resolutions !== undefined &&
    (!Array.isArray(resolutions) || !resolutions.every((item) => typeof item === "string"))
  ) {
    throw new Error("Stored Acceptance Context Snapshot resolutions are invalid");
  }
  return {
    version: 1 as const,
    title: get(value, "title") as string,
    description: get(value, "description") as string,
    ...(get(value, "comments") === undefined
      ? {}
      : { comments: get(value, "comments") as string[] }),
    ...(resolutions === undefined ? {} : { resolutions: resolutions as string[] }),
  };
};

const decodeAgentEnvironment = (value: unknown): AgentEnvironmentCommand => {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Stored Agent Environment is invalid");
  return value.map((item) => nonBlankString(item, "Agent Environment entry"));
};

const decodeRuntimeProfile = (value: unknown): ResolvedPiAgentProfile => {
  if (!isRecord(value)) throw new Error("Stored Agent Profile is invalid");
  const agentProfile = configName(get(value, "agentProfile"), "Agent Profile name");
  const scope = requiredString(get(value, "scope"), "Agent Profile scope");
  if (scope !== "repo" && scope !== "global")
    throw new Error("Stored Agent Profile scope is invalid");
  const profileValue = get(value, "profile");
  if (!isRecord(profileValue) || get(profileValue, "agentRuntime") !== "pi")
    throw new Error("Stored Agent Profile runtime is invalid");
  const runtimeConfig = get(profileValue, "runtimeConfig");
  if (runtimeConfig !== undefined) {
    if (!isRecord(runtimeConfig)) throw new Error("Stored Agent Profile runtime config is invalid");
    if (get(runtimeConfig, "model") !== undefined)
      nonBlankString(get(runtimeConfig, "model"), "Agent Profile model");
    const thinking = get(runtimeConfig, "thinking");
    if (
      thinking !== undefined &&
      !["off", "minimal", "low", "medium", "high", "xhigh"].includes(thinking as string)
    )
      throw new Error("Stored Agent Profile thinking level is invalid");
    for (const key of ["extensions", "skills", "tools"]) {
      const list = get(runtimeConfig, key);
      if (
        list !== undefined &&
        (!Array.isArray(list) ||
          !list.every((item) => typeof item === "string" && item.trim() !== ""))
      )
        throw new Error(`Stored Agent Profile ${key} are invalid`);
    }
    const discovery = get(runtimeConfig, "contextFileDiscovery");
    if (discovery !== undefined && typeof discovery !== "boolean")
      throw new Error("Stored Agent Profile context discovery is invalid");
  }
  return { agentProfile, scope, profile: profileValue as ResolvedPiAgentProfile["profile"] };
};

const decodeCommand = (value: unknown, description: string) => {
  if (!isRecord(value)) throw new Error(`Stored ${description} is invalid`);
  return {
    command: nonBlankString(get(value, "command"), `${description} command`),
    timeoutSeconds: requiredPositiveInteger(get(value, "timeoutSeconds"), `${description} timeout`),
  };
};

const decodeReviewerPolicy = (value: unknown, specialist: boolean) => {
  if (!isRecord(value)) throw new Error("Stored reviewer policy is invalid");
  const source = requiredString(get(value, "instructionsSource"), "reviewer instructions source");
  if (source !== "repo" && source !== "global" && source !== "built_in")
    throw new Error("Stored reviewer instructions source is invalid");
  if (specialist && source === "built_in")
    throw new Error("Stored Specialist instructions source is invalid");
  const scope = requiredString(get(value, "profileScope"), "reviewer profile scope");
  if (scope !== "repo" && scope !== "global")
    throw new Error("Stored reviewer profile scope is invalid");
  return {
    ...(specialist ? { id: configName(get(value, "id"), "Specialist ID") } : {}),
    instructions: nonBlankString(get(value, "instructions"), "reviewer instructions"),
    instructionsSource: source as "repo" | "global" | "built_in",
    agentProfile: configName(get(value, "agentProfile"), "reviewer Agent Profile"),
    profileScope: scope as "repo" | "global",
    profile: decodeRuntimeProfile(get(value, "profile")),
  };
};

export const decodeSqliteCandidateValidationPolicy = (
  encoded: string,
): CandidateValidationPolicySnapshot => {
  const value = parseSqliteJson(encoded, "Candidate Validation Policy Snapshot");
  if (!isRecord(value)) throw new Error("Stored Candidate Validation Policy Snapshot is invalid");
  const checksValue = get(value, "checks");
  const copyFiles = get(value, "copyFiles");
  if (!Array.isArray(checksValue) || checksValue.length === 0 || !checksValue.every(isRecord))
    throw new Error("Stored Candidate Validation Policy checks are invalid");
  if (!Array.isArray(copyFiles))
    throw new Error("Stored Candidate Validation Policy copy files are invalid");
  const policy: CandidateValidationPolicySnapshot = {
    ...(get(value, "acceptanceContext") === undefined
      ? {}
      : { acceptanceContext: decodeAcceptanceContextValue(get(value, "acceptanceContext")) }),
    ...(get(value, "agentEnvironment") === undefined
      ? {}
      : { agentEnvironment: decodeAgentEnvironment(get(value, "agentEnvironment")) }),
    ...(get(value, "prepare") === undefined
      ? {}
      : { prepare: decodeCommand(get(value, "prepare"), "validation prepare") }),
    checks: checksValue.map((check) => ({
      id: checkId(get(check, "id"), "validation check ID"),
      command: nonBlankString(get(check, "command"), "validation check command"),
      timeoutSeconds: requiredPositiveInteger(
        get(check, "timeoutSeconds"),
        "validation check timeout",
      ),
    })),
    copyFiles: copyFiles.map((file) => repoRelativePath(file, "validation copy file")),
    ...(get(value, "acceptanceReview") === undefined
      ? {}
      : { acceptanceReview: decodeReviewerPolicy(get(value, "acceptanceReview"), false) }),
    ...(get(value, "specialistReviews") === undefined
      ? {}
      : {
          specialistReviews: (() => {
            const reviews = get(value, "specialistReviews");
            if (!Array.isArray(reviews)) throw new Error("Stored Specialist Reviews are invalid");
            return reviews.map((review) => decodeReviewerPolicy(review, true)) as NonNullable<
              CandidateValidationPolicySnapshot["specialistReviews"]
            >;
          })(),
        }),
  };
  return policy;
};

export const decodeSqliteImplementationDecisions = (
  encoded: string,
): readonly ImplementationDecision[] => {
  const value = parseSqliteJson(encoded, "Validation Run Implementation Decisions");
  if (!Array.isArray(value))
    throw new Error("Stored Validation Run Implementation Decisions are invalid");
  return value.map((item) => {
    if (!isRecord(item))
      throw new Error("Stored Validation Run Implementation Decision is invalid");
    return {
      id: requiredString(get(item, "id"), "Implementation Decision ID"),
      changeId: requiredString(get(item, "changeId"), "Implementation Decision Change ID"),
      sequence: requiredPositiveInteger(get(item, "sequence"), "Implementation Decision sequence"),
      recordedAt: requiredString(get(item, "recordedAt"), "Implementation Decision timestamp"),
      choice: requiredString(get(item, "choice"), "Implementation Decision choice"),
      rationale: requiredString(get(item, "rationale"), "Implementation Decision rationale"),
    };
  });
};

export const decodeChangePrepareFailureValue = (encoded: string): ChangePrepareFailure => {
  const value = parseSqliteJson(encoded, "Change preparation failure");
  if (!isRecord(value)) throw new Error("Stored Change preparation failure is invalid");
  const timedOut = get(value, "timedOut");
  if (typeof timedOut !== "boolean")
    throw new Error("Stored Change preparation timeout flag is invalid");
  return {
    command: requiredString(get(value, "command"), "Change preparation failure command"),
    exitCode: requiredInteger(get(value, "exitCode"), "Change preparation failure exit code"),
    timedOut,
    stdout: requiredString(get(value, "stdout"), "Change preparation failure stdout"),
    stderr: requiredString(get(value, "stderr"), "Change preparation failure stderr"),
  };
};
