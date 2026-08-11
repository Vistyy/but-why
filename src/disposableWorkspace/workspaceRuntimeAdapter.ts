import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { type AgentProvider, createSandbox, pi } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import { prependAgentEnvironment, shellQuote } from "../agent/agentEnvironment.js";
import { piResourceFlags } from "../agent/piRuntime.js";
import type { ReviewerProcessExecutor, ReviewerProcessResult } from "../agent/reviewerExecution.js";
import { ReviewerProcessExecutionFailed } from "../agent/reviewerExecution.js";
import type { WorkspaceCommandExecutor } from "../command/workspaceCommand.js";
import { WorkspaceCommandExecutionFailed } from "../command/workspaceCommand.js";

export type WorkspaceRuntime = {
  readonly close: () => Promise<{ readonly preservedWorktreePath?: string }>;
  readonly worktreePath: string;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly reviewerExecutor: ReviewerProcessExecutor;
};

export type ReviewerProcessRuntimeRunInput = {
  readonly agentHandle: unknown;
  readonly buildPrintCommand: (input: {
    readonly prompt: string;
    readonly dangerouslySkipPermissions: boolean;
  }) => { readonly command: string };
  readonly prompt: string;
  readonly resumeSession?: string;
  readonly maxIterations: number;
  readonly name: string;
};

export type ReviewerProcessRuntimeRunResult = {
  readonly iterations: readonly { readonly sessionId?: string }[];
  readonly stdout: string;
  readonly resume?: (prompt: string) => Promise<ReviewerProcessRuntimeRunResult>;
};

export type ReviewerProcessRuntimeRunner = (
  input: ReviewerProcessRuntimeRunInput,
) => Promise<ReviewerProcessRuntimeRunResult>;

export const createWorkspaceRuntime = async (input: {
  readonly repoRoot: string;
  readonly tempRefName: string;
  readonly copyFiles: readonly string[];
}): Promise<WorkspaceRuntime> => {
  const sandbox = await createSandbox({
    cwd: input.repoRoot,
    branch: input.tempRefName,
    sandbox: noSandbox(),
    copyToWorktree: [...input.copyFiles],
  });

  return {
    worktreePath: sandbox.worktreePath,
    close: () => sandbox.close(),
    commandExecutor: async (command, options) => {
      try {
        return await sandbox.exec(command, options);
      } catch (error) {
        throw new WorkspaceCommandExecutionFailed({ message: errorMessage(error) });
      }
    },
    reviewerExecutor: createReviewerProcessExecutor((review) =>
      sandbox.run({
        agent: review.agentHandle as AgentProvider,
        prompt: review.prompt,
        ...(review.resumeSession === undefined ? {} : { resumeSession: review.resumeSession }),
        maxIterations: review.maxIterations,
        name: review.name,
      }),
    ),
  };
};

export const createReviewerProcessExecutor = (
  runReviewerProcess: ReviewerProcessRuntimeRunner,
): ReviewerProcessExecutor => ({
  execute: async (input) => {
    const execute = async (captureSessions: boolean): Promise<ReviewerProcessResult> => {
      const agent = isolatedPiReviewerAgent(
        input.profile,
        input.resourceRoot,
        input.agentEnvironment,
        input.sessionStorageRoot,
        captureSessions,
      );
      await prepareHostPiSession(agent, input.commandCwd, input.resumeSession);
      const result = await runReviewerProcess({
        agentHandle: agent,
        buildPrintCommand: (options) => agent.buildPrintCommand(options),
        prompt: input.prompt,
        ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
        maxIterations: 1,
        name: `${input.reviewer} Review${captureSessions ? "" : " without session capture"}`,
      });
      return reviewerProcessResult(agent, result);
    };

    try {
      return await execute(true);
    } catch (error) {
      if (/session capture failed/i.test(errorMessage(error))) {
        input.onSessionCaptureFailure();
        try {
          const recovered = await execute(false);
          const {
            resume: _resume,
            sessionFilePath: _sessionFilePath,
            sessionReference: _sessionReference,
            ...result
          } = recovered;
          return { ...result, sessionCaptureUnavailable: true };
        } catch (recoveryError) {
          throw reviewerProcessExecutionFailed(recoveryError);
        }
      }
      throw reviewerProcessExecutionFailed(error);
    }
  },
});

const isolatedPiReviewerAgent = (
  profile: Parameters<ReviewerProcessExecutor["execute"]>[0]["profile"],
  resourceRoot: string,
  agentEnvironment: Parameters<ReviewerProcessExecutor["execute"]>[0]["agentEnvironment"],
  sessionStorageRoot: string | undefined,
  captureSessions: boolean,
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

const reviewerProcessResult = async (
  agent: AgentProvider,
  result: ReviewerProcessRuntimeRunResult,
): Promise<ReviewerProcessResult> => {
  const metadata = await sessionMetadata(agent, result);
  return {
    stdout: result.stdout,
    ...metadata,
    ...(result.resume === undefined
      ? {}
      : {
          resume: async (prompt: string) => {
            const resume = result.resume;
            if (resume === undefined) throw new Error("Reviewer continuation is unavailable.");
            try {
              return reviewerProcessResult(agent, await resume(prompt));
            } catch (error) {
              throw error instanceof ReviewerProcessExecutionFailed
                ? error
                : reviewerProcessExecutionFailed(error);
            }
          },
        }),
  };
};

const sessionMetadata = async (
  agent: AgentProvider,
  result: ReviewerProcessRuntimeRunResult,
): Promise<{ readonly sessionReference?: string; readonly sessionFilePath?: string }> => {
  const iteration = result.iterations[result.iterations.length - 1];
  if (iteration?.sessionId === undefined || agent.sessionStorage === undefined) return {};
  const located = await agent.sessionStorage.findByIdOnHost(iteration.sessionId);
  if (located.path === undefined) return {};
  return { sessionReference: iteration.sessionId, sessionFilePath: located.path };
};

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

const reviewerProcessExecutionFailed = (error: unknown): ReviewerProcessExecutionFailed => {
  const message = errorMessage(error);
  return new ReviewerProcessExecutionFailed({
    message,
    sessionUsability:
      /^resumeSession ".+" not found(?: under|: expected)/m.test(message) ||
      /^Session resume failed:/m.test(message) ||
      /^Reviewer Session (?:JSONL is corrupt|header is (?:incompatible|missing))\.$/m.test(
        message,
      ) ||
      /No session found matching/m.test(message)
        ? "unusable"
        : "unknown",
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
