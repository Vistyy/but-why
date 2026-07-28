import { pi, type Sandbox, type SandboxRunResult } from "@ai-hero/sandcastle";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";

import { prependAgentEnvironment, type AgentEnvironmentCommand } from "./agentEnvironment.js";
import { piResourceFlags } from "./piRuntime.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";
import { buildReviewerOutputCorrectionPrompt } from "./reviewerPrompts.js";
import {
  decodeReviewerOutputContract,
  validateReviewerArtifactRefs,
  type ReviewerOutput,
} from "../contracts/reviewerOutput.js";
import {
  SandcastleToolingFailed,
  type ValidationToolingFailure,
} from "../change/validation/validationToolingFailures.js";

export type ReviewerAgentRuntime = {
  readonly review: (input: ReviewerAgentInput) => Effect.Effect<ReviewerAgentResult>;
};

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

export type ReviewerAgentResult =
  | {
      readonly ok: true;
      readonly report: ReviewerOutput;
      readonly attempts: number;
      readonly stdout: string;
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    }
  | {
      readonly ok: false;
      readonly failure: ValidationToolingFailure;
      readonly attempts: number;
      readonly stdout: string;
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    };

const reviewWithPi = (input: ReviewerAgentInput): Effect.Effect<ReviewerAgentResult> =>
  Effect.gen(function* () {
    const sessionSnapshot =
      input.resumeSession === undefined || input.sessionStorageRoot === undefined
        ? undefined
        : snapshotSessionRoot(input.sessionStorageRoot);
    const restoreSession = () => {
      if (sessionSnapshot !== undefined) restoreSessionRoot(sessionSnapshot);
    };
    const initial = yield* Effect.either(
      runSandbox(() =>
        input.sandbox.run({
          agent: isolatedPiReviewerAgent(
            input.profile,
            input.resourceRoot ?? input.commandCwd ?? ".",
            input.agentEnvironment,
            input.sessionStorageRoot,
          ),
          prompt: input.prompt,
          ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
          maxIterations: 1,
          name: `${input.reviewer} Review`,
        }),
      ),
    );
    if (initial._tag === "Left" && /session capture failed/i.test(initial.left.message)) {
      restoreSession();
      const recovered = yield* Effect.either(
        runSandbox(() =>
          input.sandbox.run({
            agent: isolatedPiReviewerAgent(
              input.profile,
              input.resourceRoot ?? input.commandCwd ?? ".",
              input.agentEnvironment,
              input.sessionStorageRoot,
              false,
            ),
            prompt: input.prompt,
            ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
            maxIterations: 1,
            name: `${input.reviewer} Review without session capture`,
          }),
        ),
      );
      if (recovered._tag === "Right") {
        const decoded = yield* Effect.either(validateRunResult(input, recovered.right, 1));
        if (decoded._tag === "Right") {
          cleanupSessionSnapshot(sessionSnapshot);
          return { ok: true, report: decoded.right, attempts: 1, stdout: recovered.right.stdout };
        }
        restoreSession();
        return { ok: false, failure: decoded.left, attempts: 1, stdout: recovered.right.stdout };
      }
    }
    if (initial._tag === "Left") {
      restoreSession();
      return sandcastleFailure(initial.left, 1, "");
    }

    const first = yield* Effect.either(validateRunResult(input, initial.right, 1));
    if (first._tag === "Right") {
      cleanupSessionSnapshot(sessionSnapshot);
      return {
        ok: true,
        report: first.right,
        attempts: 1,
        stdout: initial.right.stdout,
        ...sessionMetadata(initial.right),
      };
    }
    const resume = initial.right.resume;
    if (resume === undefined) {
      restoreSession();
      return {
        ok: false,
        failure: first.left,
        attempts: 1,
        stdout: initial.right.stdout,
        ...sessionMetadata(initial.right),
      };
    }

    const corrected = yield* Effect.either(
      runSandbox(() => resume(buildReviewerOutputCorrectionPrompt(first.left))),
    );
    if (corrected._tag === "Left") {
      restoreSession();
      return sandcastleFailure(corrected.left, 2, initial.right.stdout);
    }

    const second = yield* Effect.either(validateRunResult(input, corrected.right, 2));
    return second._tag === "Right"
      ? (cleanupSessionSnapshot(sessionSnapshot),
        {
          ok: true,
          report: second.right,
          attempts: 2,
          stdout: corrected.right.stdout,
          ...sessionMetadata(corrected.right),
        })
      : (() => {
          restoreSession();
          return {
            ok: false,
            failure: second.left,
            attempts: 2,
            stdout: corrected.right.stdout,
            ...sessionMetadata(corrected.right),
          };
        })();
  });

export const piReviewerAgentRuntime: ReviewerAgentRuntime = {
  review: reviewWithPi,
};

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
      : { sessionStorage: { hostSessionsDir: sessionStorageRoot } }),
  });

  return {
    ...base,
    buildPrintCommand: (options: Parameters<typeof base.buildPrintCommand>[0]) => {
      const command = base.buildPrintCommand(options);
      return {
        ...command,
        command: prependAgentEnvironment(
          `${command.command}${resourceFlags.length === 0 ? "" : ` ${resourceFlags}`}`,
          agentEnvironment,
        ),
      };
    },
  };
};

const validateRunResult = (input: ReviewerAgentInput, result: SandboxRunResult, attempts: number) =>
  decodeReviewerOutputContract({
    reviewer: input.reviewer,
    attempts,
    output: parseTaggedReviewerOutput(result.stdout),
  }).pipe(
    Effect.flatMap((output) =>
      validateReviewerArtifactRefs({
        reviewer: input.reviewer,
        attempts,
        validationRunId: input.validationRunId,
        output,
        availableArtifactRefs: input.availableArtifactRefs,
      }),
    ),
  );

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
): ReviewerAgentResult => ({ ok: false, failure, attempts, stdout });

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
  rmSync(value.snapshot, { recursive: true, force: true });
};

const sessionMetadata = (result: SandboxRunResult) => {
  const iteration = result.iterations[result.iterations.length - 1];
  return iteration?.sessionId === undefined
    ? {}
    : {
        sessionReference: iteration.sessionId,
        ...(iteration.sessionFilePath === undefined
          ? {}
          : { sessionFilePath: iteration.sessionFilePath }),
      };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
