import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AgentProvider, pi, type Sandbox, type SandboxRunResult } from "@ai-hero/sandcastle";
import { Effect } from "effect";
import {
  type ReviewerExecutionFailure,
  SandcastleToolingFailed,
} from "./reviewerExecutionFailure.js";
import {
  decodeValidationReviewerOutput,
  type ReviewerOutput,
} from "../contracts/reviewerOutput.js";
import type { ReviewerOutputContractFailed } from "../contracts/reviewerOutputContractFailure.js";
import {
  type AgentEnvironmentCommand,
  prependAgentEnvironment,
  shellQuote,
} from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import { piResourceFlags } from "./piRuntime.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";
import { buildReviewerOutputCorrectionPrompt } from "./reviewerPrompts.js";

export type ReviewerAgentRuntime<Report = ReviewerOutput> = {
  readonly review: (input: ReviewerAgentInput) => Effect.Effect<ReviewerAgentResult<Report>>;
};

export type ReviewerSessionUsability = "unusable" | "unknown";

export type ReviewerAgentInput = {
  readonly sandbox: Pick<Sandbox, "run">;
  readonly reviewer: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly prompt: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly commandCwd?: string;
  readonly resourceRoot?: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly sessionStorageRoot?: string;
  readonly resumeSession?: string;
};

export type ReviewerAgentResult<Report = ReviewerOutput> =
  | {
      readonly ok: true;
      readonly report: Report;
      readonly attempts: number;
      readonly stdout: string;
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    }
  | {
      readonly ok: false;
      readonly failure: ReviewerExecutionFailure;
      readonly sessionUsability: ReviewerSessionUsability;
      readonly attempts: number;
      readonly stdout: string;
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    };

type ReviewerOutputDecoder<Report> = (input: {
  readonly reviewer: string;
  readonly attempts: number;
  readonly output: unknown;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
}) => Effect.Effect<Report, ReviewerOutputContractFailed>;

const reviewWithPi = <Report>(
  input: ReviewerAgentInput,
  decodeOutput: ReviewerOutputDecoder<Report>,
): Effect.Effect<ReviewerAgentResult<Report>> =>
  Effect.gen(function* () {
    const sessionSnapshot =
      input.resumeSession === undefined || input.sessionStorageRoot === undefined
        ? undefined
        : snapshotSessionRoot(input.sessionStorageRoot);
    const resetSession = () => {
      if (sessionSnapshot !== undefined) restoreSessionRoot(sessionSnapshot);
    };
    const restoreSession = () => {
      resetSession();
      cleanupSessionSnapshot(sessionSnapshot);
    };
    const agent = isolatedPiReviewerAgent(
      input.profile,
      input.resourceRoot ?? input.commandCwd ?? ".",
      input.agentEnvironment,
      input.sessionStorageRoot,
    );
    const initial = yield* Effect.either(
      runSandbox(() =>
        prepareHostPiSession(
          agent,
          input.commandCwd ?? input.resourceRoot ?? ".",
          input.resumeSession,
        ).then(() =>
          input.sandbox.run({
            agent,
            prompt: input.prompt,
            ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
            maxIterations: 1,
            name: `${input.reviewer} Review`,
          }),
        ),
      ),
    );
    if (initial._tag === "Left" && /session capture failed/i.test(initial.left.message)) {
      resetSession();
      const recoveryAgent = isolatedPiReviewerAgent(
        input.profile,
        input.resourceRoot ?? input.commandCwd ?? ".",
        input.agentEnvironment,
        input.sessionStorageRoot,
        false,
      );
      const recovered = yield* Effect.either(
        runSandbox(() =>
          prepareHostPiSession(
            recoveryAgent,
            input.commandCwd ?? input.resourceRoot ?? ".",
            input.resumeSession,
          ).then(() =>
            input.sandbox.run({
              agent: recoveryAgent,
              prompt: input.prompt,
              ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
              maxIterations: 1,
              name: `${input.reviewer} Review without session capture`,
            }),
          ),
        ),
      );
      if (recovered._tag === "Right") {
        const decoded = yield* Effect.either(
          validateRunResult(input, decodeOutput, recovered.right, 1),
        );
        if (decoded._tag === "Right") {
          restoreSession();
          return {
            ok: true,
            report: decoded.right,
            attempts: 1,
            stdout: recovered.right.stdout,
          };
        }
        restoreSession();
        return {
          ok: false,
          failure: decoded.left,
          sessionUsability: "unknown",
          attempts: 1,
          stdout: recovered.right.stdout,
        };
      }
    }
    if (initial._tag === "Left") {
      restoreSession();
      return sandcastleFailure(initial.left, 1, "");
    }

    let current = initial.right;
    let validation = yield* Effect.either(validateRunResult(input, decodeOutput, current, 1));
    if (validation._tag === "Right") {
      cleanupSessionSnapshot(sessionSnapshot);
      return {
        ok: true,
        report: validation.right,
        attempts: 1,
        stdout: current.stdout,
        ...(yield* sessionMetadata(agent, current)),
      };
    }
    let attempts = 1;
    while (validation._tag === "Left" && attempts < 3) {
      const failure = validation.left;
      const resume = current.resume;
      if (resume === undefined) {
        restoreSession();
        return {
          ok: false,
          failure,
          sessionUsability: "unknown",
          attempts,
          stdout: current.stdout,
          ...(yield* sessionMetadata(agent, current)),
        };
      }
      attempts += 1;
      const corrected = yield* Effect.either(
        runSandbox(() => resume(buildReviewerOutputCorrectionPrompt(failure))),
      );
      if (corrected._tag === "Left") {
        restoreSession();
        return sandcastleFailure(corrected.left, attempts, current.stdout);
      }
      current = corrected.right;
      validation = yield* Effect.either(validateRunResult(input, decodeOutput, current, attempts));
    }
    if (validation._tag === "Right") {
      cleanupSessionSnapshot(sessionSnapshot);
      return {
        ok: true,
        report: validation.right,
        attempts,
        stdout: current.stdout,
        ...(yield* sessionMetadata(agent, current)),
      };
    }
    restoreSession();
    return {
      ok: false,
      failure: validation.left,
      sessionUsability: "unknown",
      attempts,
      stdout: current.stdout,
      ...(yield* sessionMetadata(agent, current)),
    };
  });

export const piReviewerAgentRuntimeFor = <Report>(
  decodeOutput: ReviewerOutputDecoder<Report>,
): ReviewerAgentRuntime<Report> => ({
  review: (input) => reviewWithPi(input, decodeOutput),
});

export const piReviewerAgentRuntime = piReviewerAgentRuntimeFor(decodeValidationReviewerOutput);

const isolatedPiReviewerAgent = (
  profile: ResolvedPiAgentProfile,
  resourceRoot: string,
  agentEnvironment: AgentEnvironmentCommand | undefined,
  sessionStorageRoot: string | undefined,
  captureSessions = true,
) => {
  const model = profile.profile.runtimeConfig?.model;
  if (model === undefined) throw new Error("Reviewer Pi Agent Profile has no model.");
  const thinking = profile.profile.runtimeConfig?.thinking;
  const resourceFlags = piResourceFlags(
    profile.profile.runtimeConfig,
    {
      scope: profile.scope,
      repoRoot: resourceRoot,
      globalConfigDirectory: profile.globalConfigDirectory,
    },
    { reviewerHygiene: true },
  );
  const base = pi(model, {
    ...(thinking === undefined ? {} : { thinking }),
    captureSessions,
    ...(sessionStorageRoot === undefined
      ? {}
      : { sessionStorage: { hostSessionsDir: dirname(sessionStorageRoot) } }),
  });

  return {
    ...base,
    buildPrintCommand: (options: Parameters<typeof base.buildPrintCommand>[0]) => {
      const command = base.buildPrintCommand(options);
      return {
        ...command,
        command: prependAgentEnvironment(
          `${command.command}${sessionStorageRoot === undefined ? "" : ` --session-dir ${shellQuote(sessionStorageRoot)}`}${resourceFlags.length === 0 ? "" : ` ${resourceFlags}`}`,
          agentEnvironment,
        ),
      };
    },
  };
};

const validateRunResult = <Report>(
  input: ReviewerAgentInput,
  decodeOutput: ReviewerOutputDecoder<Report>,
  result: SandboxRunResult,
  attempts: number,
) =>
  decodeOutput({
    reviewer: input.reviewer,
    attempts,
    output: parseTaggedReviewerOutput(result.stdout),
    validationRunId: input.validationRunId,
    availableArtifactRefs: input.availableArtifactRefs,
  });

const runSandbox = (
  run: () => Promise<SandboxRunResult>,
): Effect.Effect<SandboxRunResult, SandcastleToolingFailed> =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: errorMessage(error),
      }),
  });

const sandcastleFailure = (
  failure: SandcastleToolingFailed,
  attempts: number,
  stdout: string,
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: classifyReviewerSessionUsability(failure),
  attempts,
  stdout,
});

const classifyReviewerSessionUsability = (
  failure: ReviewerExecutionFailure,
): ReviewerSessionUsability =>
  failure._tag === "SandcastleToolingFailed" &&
  (/^resumeSession ".+" not found(?: under|: expected)/m.test(failure.message) ||
    /^Session resume failed:/m.test(failure.message) ||
    /^Reviewer Session (?:JSONL is corrupt|header is (?:incompatible|missing))\.$/m.test(
      failure.message,
    ) ||
    /No session found matching/m.test(failure.message))
    ? "unusable"
    : "unknown";

const prepareHostPiSession = async (
  agent: AgentProvider,
  cwd: string,
  sessionId: string | undefined,
): Promise<void> => {
  if (sessionId === undefined || agent.sessionStorage === undefined) return;
  const located = await agent.sessionStorage.findByIdOnHost(sessionId);
  if (located.path === undefined) return;
  const content = readFileSync(located.path, "utf8");
  let sessionHeaderFound = false;
  const rewritten = content
    .split("\n")
    .map((line) => {
      if (line === "") return line;
      const entry = parseSessionEntry(line);
      if (entry.type !== "session") return line;
      if (sessionHeaderFound || entry.id !== sessionId || typeof entry.cwd !== "string") {
        throw new Error("Reviewer Session header is incompatible.");
      }
      sessionHeaderFound = true;
      return JSON.stringify({ ...entry, cwd });
    })
    .join("\n");
  if (!sessionHeaderFound) throw new Error("Reviewer Session header is missing.");
  if (rewritten === content) return;
  const temporaryPath = `${located.path}.but-why-tmp`;
  writeFileSync(temporaryPath, rewritten, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, located.path);
};

type SessionEntry = Record<string, unknown> & {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly cwd?: unknown;
};

const parseSessionEntry = (line: string): SessionEntry => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Reviewer Session JSONL is corrupt.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Reviewer Session JSONL is corrupt.");
  }
  return value as SessionEntry;
};

const snapshotSessionRoot = (
  root: string,
): { readonly root: string; readonly snapshot: string } | undefined => {
  if (!existsSync(root)) return undefined;
  const snapshot = mkdtempSync(join(tmpdir(), "but-why-reviewer-session-"));
  cpSync(root, join(snapshot, "sessions"), { recursive: true });
  return { root, snapshot };
};

const cleanupSessionSnapshot = (
  value: { readonly root: string; readonly snapshot: string } | undefined,
): void => {
  if (value !== undefined) rmSync(value.snapshot, { recursive: true, force: true });
};

const restoreSessionRoot = (value: { readonly root: string; readonly snapshot: string }): void => {
  const source = join(value.snapshot, "sessions");
  rmSync(value.root, { recursive: true, force: true });
  cpSync(source, value.root, { recursive: true });
};

const sessionMetadata = (
  agent: AgentProvider,
  result: SandboxRunResult,
): Effect.Effect<{ readonly sessionReference?: string; readonly sessionFilePath?: string }> =>
  Effect.promise(async () => {
    const iteration = result.iterations[result.iterations.length - 1];
    if (iteration?.sessionId === undefined || agent.sessionStorage === undefined) return {};
    const located = await agent.sessionStorage.findByIdOnHost(iteration.sessionId);
    if (located.path === undefined) return {};
    return {
      sessionReference: iteration.sessionId,
      sessionFilePath: located.path,
    };
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
