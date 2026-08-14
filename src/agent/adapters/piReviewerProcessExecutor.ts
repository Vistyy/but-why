import { chmodSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";
import {
  executeHostCommandEffect,
  type HostCommandError,
  type HostCommandInput,
  type HostCommandResult,
} from "../../command/hostCommand.js";
import type { AgentEnvironmentCommand } from "../agentEnvironment.js";
import {
  decodePiAssistantMessageEnd,
  decodePiAssistantText,
  decodePiJsonlObject,
  decodePiMessageUsage,
  decodePiSessionHeader,
  decodePiSessionIdentity,
  isPiSessionRecord,
} from "../piJsonl.js";
import { piResourceArgs } from "../piRuntime.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessInput,
  ReviewerProcessResult,
} from "../reviewerExecution.js";
import { ReviewerProcessExecutionFailed } from "../reviewerExecution.js";
import type { TokenUsage } from "../tokenUsage.js";

type PiCommandExecutor = (
  input: HostCommandInput,
) => Effect.Effect<HostCommandResult, HostCommandError>;

const executePiReviewerProcess = (
  input: ReviewerProcessInput,
  executeCommand: PiCommandExecutor,
): Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed> =>
  Effect.gen(function* () {
    if (input.resumeSession !== undefined) {
      yield* Effect.try({
        try: () => preparePiSession(input),
        catch: (error) => reviewerProcessExecutionFailed(error),
      });
    }

    const invocation = yield* Effect.try({
      try: () => commandInvocation(input),
      catch: (error) => reviewerProcessExecutionFailed(error),
    });
    const commandResult = yield* executeCommand({
      command: invocation.command,
      args: invocation.args,
      cwd: input.commandCwd,
    }).pipe(Effect.mapError((error) => reviewerProcessExecutionFailed(error)));
    if (commandResult.exitCode !== 0) {
      const diagnostic = [commandResult.stderr.trim(), commandResult.stdout.trim()]
        .filter((value) => value.length > 0)
        .join("\n");
      return yield* Effect.fail(
        reviewerProcessExecutionFailed(
          diagnostic.length > 0
            ? diagnostic
            : `Pi reviewer exited with status ${commandResult.exitCode}.`,
        ),
      );
    }
    const parsed = yield* Effect.try({
      try: () => parsePiOutput(commandResult.stdout),
      catch: (error) => reviewerProcessExecutionFailed(error),
    });

    const sessionStorageRoot = input.sessionStorageRoot;
    const sessionReference =
      sessionStorageRoot === undefined
        ? undefined
        : (input.sessionId ?? parsed.sessionReference ?? input.resumeSession);
    const sessionFilePath =
      sessionReference === undefined || sessionStorageRoot === undefined
        ? undefined
        : findSessionFile(sessionStorageRoot, sessionReference);
    const result: ReviewerProcessResult = {
      stdout: parsed.stdout,
      invocationUsage: parsed.usage ?? null,
      ...(sessionReference === undefined ? {} : { sessionReference }),
      ...(sessionFilePath === undefined ? {} : { sessionFilePath }),
    };

    return sessionReference === undefined
      ? result
      : {
          ...result,
          resume: (prompt) =>
            executePiReviewerProcess(
              {
                ...input,
                prompt,
                sessionId: sessionReference,
                resumeSession: sessionReference,
              },
              executeCommand,
            ),
        };
  });

export const createPiReviewerProcessExecutor = (
  executeCommand: PiCommandExecutor = executeHostCommandEffect,
): ReviewerProcessExecutor => ({
  execute: (input) => executePiReviewerProcess(input, executeCommand),
});

export const piReviewerProcessExecutor = createPiReviewerProcessExecutor();

const commandInvocation = (
  input: ReviewerProcessInput,
): { readonly command: string; readonly args: readonly string[] } => {
  const model = input.profile.profile.runtimeConfig?.model;
  if (model === undefined) throw new Error("Reviewer Pi Agent Profile has no model.");
  const thinking = input.profile.profile.runtimeConfig?.thinking;
  const args = [
    "-p",
    "--mode",
    "json",
    "--model",
    model,
    ...(thinking === undefined ? [] : ["--thinking", thinking]),
    ...piResourceArgs(
      input.profile.profile.runtimeConfig,
      {
        scope: input.profile.scope,
        repoRoot: input.resourceRoot,
        globalConfigDirectory: input.profile.globalConfigDirectory,
      },
      { reviewerHygiene: true },
    ),
    ...(input.sessionStorageRoot === undefined
      ? ["--no-session"]
      : ["--session-dir", input.sessionStorageRoot]),
    ...(input.resumeSession === undefined
      ? input.sessionId === undefined
        ? []
        : input.sessionId.startsWith("by-agent-")
          ? ["--session-id", input.sessionId]
          : ["--session", input.sessionId]
      : ["--session", input.resumeSession]),
    "--name",
    `${input.reviewer} Review`,
    input.prompt,
  ];
  return applyAgentEnvironment("pi", args, input.agentEnvironment);
};

const applyAgentEnvironment = (
  command: string,
  args: readonly string[],
  environment: AgentEnvironmentCommand | undefined,
): { readonly command: string; readonly args: readonly string[] } =>
  environment === undefined || environment.length === 0
    ? { command, args }
    : { command: environment[0] ?? command, args: [...environment.slice(1), command, ...args] };

const preparePiSession = (input: ReviewerProcessInput): void => {
  if (input.resumeSession === undefined || input.sessionStorageRoot === undefined) return;
  const path = findSessionFile(input.sessionStorageRoot, input.resumeSession);
  if (path === undefined) {
    throw new Error(
      `resumeSession "${input.resumeSession}" not found under ${input.sessionStorageRoot}`,
    );
  }
  const content = readFileSync(path, "utf8");
  let headerFound = false;
  const rewritten = content
    .split("\n")
    .map((line) => {
      if (line === "") return line;
      const entry = decodeJsonlObject(line, "Reviewer Session JSONL is corrupt.");
      if (!isPiSessionRecord(entry)) return line;
      const header = decodePiSessionHeader(entry);
      if (headerFound || header?.id !== input.resumeSession) {
        throw new Error("Reviewer Session header is incompatible.");
      }
      headerFound = true;
      return JSON.stringify({ ...header, cwd: input.commandCwd });
    })
    .join("\n");
  if (!headerFound) throw new Error("Reviewer Session header is missing.");
  if (rewritten === content) return;
  const temporaryPath = `${path}.but-why-tmp`;
  writeFileSync(temporaryPath, rewritten, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
};

const parsePiOutput = (
  output: string,
): { readonly stdout: string; readonly sessionReference?: string; readonly usage?: TokenUsage } => {
  let sessionReference: string | undefined;
  let finalOutput = "";
  let usageAvailable = true;
  let assistantMessages = 0;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  for (const line of output.split("\n")) {
    if (line === "") continue;
    const event = decodeJsonlObject(line, "Pi reviewer returned malformed JSON output.");
    sessionReference = decodePiSessionIdentity(event) ?? sessionReference;
    const messageEnd = decodePiAssistantMessageEnd(event);
    if (messageEnd === undefined) continue;
    assistantMessages += 1;
    finalOutput = decodePiAssistantText(messageEnd.message.content);
    const messageUsage = decodePiMessageUsage(messageEnd.message.usage);
    if (messageUsage === undefined) {
      usageAvailable = false;
      continue;
    }
    usage.inputTokens += messageUsage.inputTokens;
    usage.cachedInputTokens += messageUsage.cachedInputTokens;
    usage.outputTokens += messageUsage.outputTokens;
    usage.totalTokens += messageUsage.totalTokens;
  }

  if (assistantMessages === 0) {
    throw new Error("Pi reviewer returned no final assistant message.");
  }

  return {
    stdout: finalOutput,
    ...(sessionReference === undefined ? {} : { sessionReference }),
    ...(usageAvailable ? { usage } : {}),
  };
};

const decodeJsonlObject = (line: string, message: string): Readonly<Record<string, unknown>> => {
  try {
    return decodePiJsonlObject(line);
  } catch {
    throw new Error(message);
  }
};

const findSessionFile = (root: string, sessionId: string): string | undefined => {
  let rootStat: ReturnType<typeof statSync>;
  try {
    rootStat = statSync(root);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Reviewer Session storage root "${root}" is not a directory.`);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findSessionFile(path, sessionId);
      if (nested !== undefined) return nested;
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".jsonl") &&
      (entry.name.includes(sessionId) || hasSessionHeader(path, sessionId))
    ) {
      return path;
    }
  }
  return undefined;
};

const hasSessionHeader = (path: string, sessionId: string): boolean => {
  let firstLine: string | undefined;
  try {
    firstLine = readFileSync(path, "utf8").split("\n", 1)[0];
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw error;
  }
  if (firstLine === undefined) return false;
  try {
    const header = decodeJsonlObject(firstLine, "Reviewer Session JSONL is corrupt.");
    return decodePiSessionIdentity(header) === sessionId;
  } catch {
    return false;
  }
};

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const reviewerProcessExecutionFailed = (error: unknown): ReviewerProcessExecutionFailed => {
  const message = error instanceof Error ? error.message : String(error);
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
