import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

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
import { findUniquePiSessionTranscript } from "../piSessionTranscript.js";
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
      stdin: input.prompt,
    }).pipe(Effect.mapError((error) => reviewerProcessExecutionFailed(error)));
    if (commandResult.exitCode !== 0) {
      const diagnostic = [commandResult.stderr.trim(), commandResult.stdout.trim()]
        .filter((value) => value.length > 0)
        .join("\n");
      const sessionMetadata = sessionMetadataAfterFailure(input, commandResult.stdout);
      const parsedEvidence = parsePiInvocationEvidence(commandResult.stdout);
      return yield* Effect.fail(
        reviewerProcessExecutionFailed(
          diagnostic.length > 0
            ? diagnostic
            : `Pi reviewer exited with status ${commandResult.exitCode}.`,
          {
            ...sessionMetadata,
            ...(parsedEvidence.usage === undefined
              ? {}
              : { invocationUsage: parsedEvidence.usage }),
          },
        ),
      );
    }
    const parsed = yield* Effect.try({
      try: () => parsePiOutput(commandResult.stdout),
      catch: (error) =>
        reviewerProcessExecutionFailed(
          error,
          sessionMetadataAfterFailure(input, commandResult.stdout),
        ),
    });

    const sessionStorageRoot = input.sessionStorageRoot;
    const sessionReference =
      sessionStorageRoot === undefined
        ? undefined
        : (input.sessionId ?? parsed.sessionReference ?? input.resumeSession);
    const sessionFilePath = yield* Effect.try({
      try: () =>
        input.resumeSession === undefined
          ? sessionReference === undefined || sessionStorageRoot === undefined
            ? undefined
            : findUniquePiSessionTranscript(sessionStorageRoot, sessionReference)
          : input.resumeSessionFilePath,
      catch: (error) => reviewerProcessExecutionFailed(error),
    });
    return {
      stdout: parsed.stdout,
      invocationUsage: parsed.usage ?? null,
      ...(sessionReference === undefined ? {} : { sessionReference }),
      ...(sessionFilePath === undefined ? {} : { sessionFilePath }),
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
      : ["--session", requiredResumeSessionFilePath(input)]),
    "--append-system-prompt",
    input.systemPrompt,
    "--name",
    `${input.reviewer} Review`,
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
  const path = requiredResumeSessionFilePath(input);
  validateContainedSessionFile(input.sessionStorageRoot, path);
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const firstLine = lines[0];
  if (firstLine === undefined || firstLine === "") {
    throw new Error("Agent Session header is missing.");
  }
  const entry = decodeJsonlObject(firstLine, "Agent Session JSONL is corrupt.");
  if (!isPiSessionRecord(entry)) throw new Error("Agent Session header is missing.");
  const header = decodePiSessionHeader(entry);
  if (header?.id !== input.resumeSession) {
    throw new Error("Agent Session header is incompatible.");
  }
  lines[0] = JSON.stringify({ ...header, cwd: input.commandCwd });
  const rewritten = lines.join("\n");
  if (rewritten === content) return;
  const temporaryPath = `${path}.but-why-tmp`;
  writeFileSync(temporaryPath, rewritten, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
};

const parsePiInvocationEvidence = (
  output: string,
): { readonly sessionReference?: string; readonly usage?: TokenUsage } => {
  let sessionReference: string | undefined;
  let usageAvailable = true;
  let messageEnds = 0;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  for (const line of output.split("\n")) {
    if (line === "") continue;
    let event: Readonly<Record<string, unknown>>;
    try {
      event = decodePiJsonlObject(line);
    } catch {
      continue;
    }
    sessionReference = decodePiSessionIdentity(event) ?? sessionReference;
    const messageEnd = decodePiAssistantMessageEnd(event);
    if (messageEnd === undefined) continue;
    messageEnds += 1;
    const messageUsage = decodePiMessageUsage(messageEnd.message.usage);
    if (messageUsage === undefined) {
      usageAvailable = false;
      continue;
    }
    usage.inputTokens += messageUsage.inputTokens;
    usage.cachedInputTokens += messageUsage.cachedInputTokens;
    usage.cacheWriteTokens += messageUsage.cacheWriteTokens;
    usage.outputTokens += messageUsage.outputTokens;
    usage.totalTokens += messageUsage.totalTokens;
  }

  return {
    ...(sessionReference === undefined ? {} : { sessionReference }),
    ...(messageEnds > 0 && usageAvailable ? { usage } : {}),
  };
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
    cacheWriteTokens: 0,
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
    usage.cacheWriteTokens += messageUsage.cacheWriteTokens;
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

const requiredResumeSessionFilePath = (input: ReviewerProcessInput): string => {
  if (input.resumeSessionFilePath === undefined) {
    throw new Error(`resumeSession "${input.resumeSession}" has no persisted transcript path.`);
  }
  return input.resumeSessionFilePath;
};

const validateContainedSessionFile = (root: string, path: string): void => {
  const rootStat = statSync(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Agent Session storage root "${root}" is not a directory.`);
  }
  const canonicalRoot = realpathSync(root);
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(path);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new Error(`resumeSession transcript "${path}" not found.`);
    }
    throw error;
  }
  const candidate = relative(canonicalRoot, canonicalPath);
  if (
    isAbsolute(candidate) ||
    candidate === "" ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`)
  ) {
    throw new Error(`resumeSession transcript "${path}" is outside ${root}.`);
  }
};

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const sessionMetadataAfterFailure = (
  input: ReviewerProcessInput,
  output: string,
): { readonly sessionReference?: string; readonly sessionFilePath?: string } => {
  const outputReference = sessionReferenceFromOutput(output);
  if (outputReference !== undefined) {
    return {
      sessionReference: outputReference,
      ...(input.resumeSession !== undefined && input.resumeSessionFilePath !== undefined
        ? { sessionFilePath: input.resumeSessionFilePath }
        : sessionFileMetadata(input.sessionStorageRoot, outputReference)),
    };
  }
  const expectedReference = input.sessionId ?? input.resumeSession;
  if (expectedReference === undefined || input.sessionStorageRoot === undefined) return {};
  if (input.resumeSession !== undefined && input.resumeSessionFilePath !== undefined) {
    return { sessionReference: expectedReference, sessionFilePath: input.resumeSessionFilePath };
  }
  const fileMetadata = sessionFileMetadata(input.sessionStorageRoot, expectedReference);
  return fileMetadata.sessionFilePath === undefined
    ? {}
    : { sessionReference: expectedReference, ...fileMetadata };
};

const sessionFileMetadata = (
  root: string | undefined,
  sessionReference: string,
): { readonly sessionFilePath?: string } => {
  if (root === undefined) return {};
  try {
    const sessionFilePath = findUniquePiSessionTranscript(root, sessionReference);
    return sessionFilePath === undefined ? {} : { sessionFilePath };
  } catch {
    return {};
  }
};

const sessionReferenceFromOutput = (output: string): string | undefined => {
  for (const line of output.split("\n")) {
    if (line === "") continue;
    try {
      const reference = decodePiSessionIdentity(decodePiJsonlObject(line));
      if (reference !== undefined) return reference;
    } catch {
      // A failed process may have written a partial JSONL stream.
    }
  }
  return undefined;
};

const reviewerProcessExecutionFailed = (
  error: unknown,
  metadata: {
    readonly invocationUsage?: TokenUsage | null;
    readonly sessionReference?: string;
    readonly sessionFilePath?: string;
  } = {},
): ReviewerProcessExecutionFailed => {
  const message = error instanceof Error ? error.message : String(error);
  return new ReviewerProcessExecutionFailed({
    message,
    sessionUsability:
      /^resumeSession ".+" (?:has no persisted transcript path|not found)/m.test(message) ||
      /^resumeSession transcript ".+" (?:is outside |not found\.)/m.test(message) ||
      /^Multiple Agent Session transcripts have id /m.test(message) ||
      /^Session resume failed:/m.test(message) ||
      /^Agent Session (?:JSONL is corrupt|header is (?:incompatible|missing))\.$/m.test(message) ||
      /No session found matching/m.test(message)
        ? "unusable"
        : "unknown",
    ...metadata,
  });
};
