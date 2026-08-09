import { readFileSync, statSync } from "node:fs";
import { createJiti } from "jiti/static";

import { piResourceArgs } from "../../agent/piRuntime.js";
import { executeHostCommand } from "../../command/hostCommand.js";
import { resolvePackageAsset } from "../packageAssetPath.js";
import type {
  InteractiveSessionHost,
  InteractiveSessionLaunchInput,
  InteractiveSessionLaunchResult,
} from "./interactiveSessionHost.js";

export type HerdrCommandExecutor = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<
  { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly message: string }
>;

export type HerdrInteractiveSessionHostOptions = {
  readonly commandTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly observationRetries?: number;
};

type ResolvedOptions = {
  readonly commandTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly observationRetries: number;
};

const defaultOptions: ResolvedOptions = {
  commandTimeoutMs: 5_000,
  readinessTimeoutMs: 120_000,
  observationRetries: 2,
};

const agentPaneBusyRetryIntervalMs = 100;

export const openHerdrInteractiveSessionHost = (
  execute: HerdrCommandExecutor = executeHerdr,
  environment: HerdrInteractiveSessionHostOptions = {},
): InteractiveSessionHost => ({
  launch: async (input, signal) => launchHerdrSession(execute, input, environment, signal),
});

export const herdrSessionName = (changeId: string): string => `but-why-${changeId}`;

export const trustedContinuationExtensionPath = (): string =>
  resolvePackageAsset("extensions/continue-change.ts");

type TrustedResourcePreflight =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const preflightFile = (path: string, label: string): TrustedResourcePreflight => {
  try {
    if (!statSync(path).isFile())
      return { ok: false, message: `${label} is not a regular file: ${path}` };
    readFileSync(path, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `${label} is missing or unreadable: ${path}${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
    };
  }
};

const preflightTrustedExtension = async (path: string): Promise<TrustedResourcePreflight> => {
  try {
    if (!statSync(path).isFile()) {
      return {
        ok: false,
        message: `Required trusted continuation extension failed preflight: Entry point is not a regular file: ${path}`,
      };
    }
  } catch {
    return { ok: false, message: `Required trusted continuation extension is missing: ${path}` };
  }
  try {
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const factory = await jiti.import(path, { default: true });
    return typeof factory === "function"
      ? { ok: true }
      : {
          ok: false,
          message: `Required trusted continuation extension failed preflight: Entry point does not export a Pi extension factory: ${path}`,
        };
  } catch (error) {
    return {
      ok: false,
      message: `Required trusted continuation extension failed preflight: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

const launchHerdrSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  environment: HerdrInteractiveSessionHostOptions,
  signal: AbortSignal | undefined,
): Promise<InteractiveSessionLaunchResult> => {
  const options = { ...defaultOptions, ...environment };
  const continuationExtension = trustedContinuationExtensionPath();
  const extensionPreflight = await preflightTrustedExtension(continuationExtension);
  if (!extensionPreflight.ok) return launchFailure(extensionPreflight.message);
  for (const [index, path] of input.systemPromptPaths.entries()) {
    const promptPreflight = preflightFile(
      path,
      `Required packaged system-prompt resource ${index + 1}`,
    );
    if (!promptPreflight.ok) return launchFailure(promptPreflight.message);
  }

  const command = boundedExecutor(execute, options.commandTimeoutMs);
  const sessionName = input.hostSessionName ?? herdrSessionName(input.changeId);
  const existing = await observe(command, ["agent", "list"], signal, options.observationRetries);
  if (!existing.ok) {
    return {
      ok: false,
      code: "host_unavailable",
      message: `Start Herdr before launching ${sessionName}: ${existing.message}`,
    };
  }
  const existingAgents = decodeAgentList(existing.stdout);
  if (existingAgents === undefined)
    return launchFailure("Herdr returned malformed agent-list output.");
  if (hasActiveSession(existingAgents, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (
    hasUnknownSession(existingAgents, input, sessionName) ||
    hasUnknownAgentInWorktree(existingAgents, input)
  ) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }

  const worktreeArgs = [
    "worktree",
    "open",
    "--cwd",
    input.repositoryPath,
    "--path",
    input.worktreePath,
    "--label",
    sessionName,
    "--no-focus",
  ] as const;
  let openedResult = await command(worktreeArgs, signal);
  if (!openedResult.ok && isUncertainMutationFailure(openedResult.message)) {
    const worktreeState = await observe(
      command,
      ["worktree", "list", "--cwd", input.worktreePath, "--json"],
      signal,
      options.observationRetries,
    );
    const worktrees = worktreeState.ok ? decodeWorktreeList(worktreeState.stdout) : undefined;
    if (worktrees === undefined || !worktreeMatchesTarget(worktrees, input.worktreePath)) {
      return launchIndeterminate(
        `Herdr did not confirm opening the Managed Worktree: ${openedResult.message}`,
      );
    }
    openedResult = await command(worktreeArgs, signal);
  }
  if (!openedResult.ok) {
    return isUncertainMutationFailure(openedResult.message)
      ? launchIndeterminate(
          `Herdr did not confirm opening the Managed Worktree: ${openedResult.message}`,
        )
      : launchFailure(openedResult.message);
  }
  const opened = decodeOpenedWorktree(openedResult.stdout);
  if (opened === undefined)
    return launchIndeterminate("Herdr returned malformed worktree-open output.");

  const beforeStart = await observe(command, ["agent", "list"], signal, options.observationRetries);
  const beforeStartAgents = beforeStart.ok ? decodeAgentList(beforeStart.stdout) : undefined;
  if (beforeStartAgents === undefined) {
    return launchIndeterminate(
      "Herdr did not provide a trustworthy pre-start session observation.",
    );
  }
  if (hasActiveSession(beforeStartAgents, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (
    hasUnknownSession(beforeStartAgents, input, sessionName) ||
    hasUnknownAgentInWorktree(beforeStartAgents, input)
  ) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }
  if (hasActiveAgentInWorktree(beforeStartAgents, input)) {
    return launchFailure("Another Interactive Session is already active in this Managed Worktree.");
  }

  const startArgs = [
    "agent",
    "start",
    sessionName,
    "--kind",
    "pi",
    "--pane",
    opened.rootPaneId,
    "--timeout",
    String(options.readinessTimeoutMs),
    "--",
    ...piArguments(input, continuationExtension),
  ];
  const started = await startAgentWhenPaneReady(
    execute,
    startArgs,
    signal,
    options.commandTimeoutMs,
    options.readinessTimeoutMs,
  );
  if (started.paneReadinessTimedOut) return paneNotReady(options.readinessTimeoutMs);
  const startResult = started.result;
  const startConfirmed = startResult.ok && isConfirmedAgentStart(startResult.stdout);
  if (!startResult.ok && !isUncertainMutationFailure(startResult.message))
    return launchFailure(startResult.message);
  if (!startConfirmed) {
    const afterStart = await observe(
      command,
      ["agent", "list"],
      signal,
      options.observationRetries,
    );
    const afterStartAgents = afterStart.ok ? decodeAgentList(afterStart.stdout) : undefined;
    if (afterStartAgents !== undefined) {
      if (hasActiveSession(afterStartAgents, input, sessionName)) {
        return submitInitialPrompt(command, input, sessionName, signal, options);
      }
      if (hasUnknownSession(afterStartAgents, input, sessionName)) {
        return launchIndeterminate("Herdr reported an unknown state after native agent start.");
      }
    }
    return launchIndeterminate(
      startResult.ok
        ? "Herdr did not confirm that native Pi startup reached readiness."
        : `Herdr did not confirm whether native Pi startup succeeded: ${startResult.message}`,
    );
  }

  return submitInitialPrompt(command, input, sessionName, signal, options);
};

type NativeAgentStart = {
  readonly result: HerdrCommandExecutorResult;
  readonly paneReadinessTimedOut: boolean;
};

const startAgentWhenPaneReady = async (
  execute: HerdrCommandExecutor,
  args: readonly string[],
  signal: AbortSignal | undefined,
  commandTimeoutMs: number,
  readinessTimeoutMs: number,
): Promise<NativeAgentStart> => {
  const deadline = performance.now() + readinessTimeoutMs;
  let result = await boundedExecutor(execute, Math.max(commandTimeoutMs, readinessTimeoutMs))(
    args,
    signal,
  );
  while (!result.ok && isAgentPaneBusyFailure(result.message)) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return { result, paneReadinessTimedOut: true };
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(agentPaneBusyRetryIntervalMs, remainingMs));
    });
    const nextAttemptTimeoutMs = deadline - performance.now();
    if (nextAttemptTimeoutMs <= 0) return { result, paneReadinessTimedOut: true };
    result = await boundedExecutor(execute, nextAttemptTimeoutMs)(args, signal);
  }
  return { result, paneReadinessTimedOut: false };
};

const submitInitialPrompt = async (
  command: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<InteractiveSessionLaunchResult> => {
  if (input.initialPrompt === undefined || input.initialPrompt.length === 0) {
    return launchFailure("The initial Change handoff is empty and was not submitted.");
  }
  if (input.initialPrompt.includes("\u0000")) {
    return launchFailure("The initial Change handoff contains NUL and was not submitted.");
  }
  const prompted = await command(["agent", "prompt", sessionName, input.initialPrompt], signal);
  if (prompted.ok && isConfirmedAgentPrompt(prompted.stdout)) {
    return { ok: true, host: "herdr", status: "started" };
  }
  if (prompted.ok)
    return launchIndeterminate("Herdr did not confirm initial Change handoff submission.");
  if (!isUncertainMutationFailure(prompted.message)) {
    return launchFailure(`Herdr rejected initial Change handoff submission: ${prompted.message}`);
  }
  const observed = await observe(command, ["agent", "list"], signal, options.observationRetries);
  return launchIndeterminate(
    observed.ok && decodeAgentList(observed.stdout) !== undefined
      ? `Herdr did not confirm whether initial Change handoff submission succeeded: ${prompted.message}`
      : `Herdr could not observe the session after uncertain initial Change handoff submission: ${prompted.message}`,
  );
};

const piArguments = (
  input: InteractiveSessionLaunchInput,
  continuationExtension: string,
): readonly string[] => {
  const profile = input.agentProfile?.profile;
  const runtimeConfig = profile?.runtimeConfig;
  const [systemPrompt, implementationInstructions] = input.systemPromptPaths;
  return [
    "--system-prompt",
    systemPrompt,
    "--append-system-prompt",
    implementationInstructions,
    "--name",
    input.agentSessionName ?? input.hostSessionName ?? herdrSessionName(input.changeId),
    ...(runtimeConfig?.model === undefined ? [] : ["--model", runtimeConfig.model]),
    ...(runtimeConfig?.thinking === undefined ? [] : ["--thinking", runtimeConfig.thinking]),
    ...piResourceArgs(
      runtimeConfig,
      {
        scope: input.agentProfile?.scope ?? "repo",
        repoRoot: input.worktreePath,
        globalConfigDirectory: input.globalConfigDirectory,
      },
      { trustedExtensions: [continuationExtension] },
    ),
  ];
};

const launchFailure = (message: string): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_failed",
  message: `Herdr could not launch the Interactive Session: ${message}`,
});

const launchIndeterminate = (message: string): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_indeterminate",
  message: `Herdr could not prove that the Interactive Session launched: ${message}`,
});

const paneNotReady = (readinessTimeoutMs: number): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "pane_not_ready",
  message: `The Herdr Managed Worktree pane shell did not become ready for native Pi startup within ${readinessTimeoutMs} ms. Wait for shell startup to finish, then retry Change Implement.`,
});

const isConfirmedAgentStart = (source: string): boolean => decodeAgentStarted(source) !== undefined;

const isConfirmedAgentPrompt = (source: string): boolean => decodeAgentPrompted(source);

const observe = async (
  execute: HerdrCommandExecutor,
  args: readonly string[],
  signal: AbortSignal | undefined,
  retries: number,
): Promise<Awaited<ReturnType<HerdrCommandExecutor>>> => {
  let result = await execute(args, signal);
  for (
    let attempt = 0;
    !result.ok && isTransientObservationFailure(result.message) && attempt < retries;
    attempt += 1
  ) {
    result = await execute(args, signal);
  }
  return result;
};

const boundedExecutor =
  (execute: HerdrCommandExecutor, timeoutMs: number): HerdrCommandExecutor =>
  async (args, signal) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        execute(args, signal),
        new Promise<HerdrCommandExecutorResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, message: `Herdr command timed out after ${timeoutMs} ms.` }),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

type HerdrCommandExecutorResult = Awaited<ReturnType<HerdrCommandExecutor>>;

const isTransientObservationFailure = (message: string): boolean =>
  /timed out|temporar|try again|connection reset|ECONNRESET|busy/i.test(message);

const isUncertainMutationFailure = (message: string): boolean =>
  /timed out|connection reset|ECONNRESET|response.*lost|lost response|no response|transport|connection.*closed|disconnected|broken pipe|eof/i.test(
    message,
  );

type JsonRecord = Record<string, unknown>;

type HerdrAgent = {
  readonly cwd: string;
  readonly agentStatus: "idle" | "working" | "blocked" | "unknown" | "done";
  readonly paneId: string;
  readonly name?: string;
  readonly agent?: string;
};

type HerdrWorktree = {
  readonly path?: string;
  readonly worktreePath?: string;
  readonly branch?: string | null;
};

type OpenedWorktree = { readonly rootPaneId: string };

const parseJsonRecord = (source: string): JsonRecord | undefined => {
  try {
    const value = JSON.parse(source) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const decodeResult = (source: string, type: string): JsonRecord | undefined => {
  const response = parseJsonRecord(source);
  const result = response?.["result"];
  return isRecord(result) && result["type"] === type ? result : undefined;
};

const decodeAgentList = (source: string): readonly HerdrAgent[] | undefined => {
  const result = decodeResult(source, "agent_list");
  const agents = result?.["agents"];
  if (!Array.isArray(agents)) return undefined;
  const decoded: HerdrAgent[] = [];
  for (const value of agents) {
    if (!isRecord(value)) return undefined;
    const status = value["agent_status"];
    if (
      typeof value["cwd"] !== "string" ||
      typeof value["pane_id"] !== "string" ||
      (status !== "idle" &&
        status !== "working" &&
        status !== "blocked" &&
        status !== "unknown" &&
        status !== "done") ||
      (value["name"] !== undefined && typeof value["name"] !== "string") ||
      (value["agent"] !== undefined && typeof value["agent"] !== "string")
    )
      return undefined;
    decoded.push({
      cwd: value["cwd"],
      agentStatus: status,
      paneId: value["pane_id"],
      ...(typeof value["name"] === "string" ? { name: value["name"] } : {}),
      ...(typeof value["agent"] === "string" ? { agent: value["agent"] } : {}),
    });
  }
  return decoded;
};

const decodeWorktreeList = (source: string): readonly HerdrWorktree[] | undefined => {
  const result = decodeResult(source, "worktree_list");
  const worktrees = result?.["worktrees"];
  if (!Array.isArray(worktrees)) return undefined;
  const decoded: HerdrWorktree[] = [];
  for (const value of worktrees) {
    if (
      !isRecord(value) ||
      (value["path"] !== undefined && typeof value["path"] !== "string") ||
      (value["worktree_path"] !== undefined && typeof value["worktree_path"] !== "string") ||
      (value["branch"] !== undefined &&
        value["branch"] !== null &&
        typeof value["branch"] !== "string")
    )
      return undefined;
    decoded.push({
      ...(value["branch"] === null || typeof value["branch"] === "string"
        ? { branch: value["branch"] }
        : {}),
      ...(typeof value["path"] === "string" ? { path: value["path"] } : {}),
      ...(typeof value["worktree_path"] === "string"
        ? { worktreePath: value["worktree_path"] }
        : {}),
    });
  }
  return decoded;
};

const decodeOpenedWorktree = (source: string): OpenedWorktree | undefined => {
  const result = decodeResult(source, "worktree_opened");
  const workspace = result?.["workspace"];
  const rootPane = result?.["root_pane"];
  return isRecord(workspace) &&
    typeof workspace["workspace_id"] === "string" &&
    isRecord(rootPane) &&
    typeof rootPane["pane_id"] === "string"
    ? { rootPaneId: rootPane["pane_id"] }
    : undefined;
};

const decodeAgentStarted = (source: string): { readonly terminalId: string } | undefined => {
  const result = decodeResult(source, "agent_started");
  const terminalId = result?.["terminal_id"];
  return typeof terminalId === "string" && terminalId.length > 0 ? { terminalId } : undefined;
};

const decodeAgentPrompted = (source: string): boolean =>
  decodeResult(source, "agent_prompted") !== undefined;

const isAgentPaneBusyFailure = (message: string): boolean => {
  const trimmed = message.trim();
  if (trimmed.split(/[:\s]/, 1)[0] === "agent_pane_busy") return true;
  const response = parseJsonRecord(trimmed);
  const error = response?.["error"];
  return isRecord(error) && error["code"] === "agent_pane_busy";
};

const hasActiveSession = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => {
  const status = findSession(agents, input, sessionName)?.agentStatus;
  return status !== undefined && isActiveAgentStatus(status);
};

const hasUnknownSession = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => findSession(agents, input, sessionName)?.agentStatus === "unknown";

const findSession = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): HerdrAgent | undefined =>
  agents.find(
    (agent) =>
      (agent.name === sessionName || agent.agent === sessionName) &&
      agent.cwd === input.worktreePath,
  );

const hasUnknownAgentInWorktree = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
): boolean =>
  agents.some((agent) => agent.cwd === input.worktreePath && agent.agentStatus === "unknown");

const hasActiveAgentInWorktree = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
): boolean =>
  agents.some(
    (agent) => agent.cwd === input.worktreePath && isActiveAgentStatus(agent.agentStatus),
  );

const isActiveAgentStatus = (status: HerdrAgent["agentStatus"]): boolean =>
  status === "idle" || status === "working" || status === "blocked";

const worktreeMatchesTarget = (worktrees: readonly HerdrWorktree[], targetPath: string): boolean =>
  worktrees.some(
    (worktree) =>
      (worktree.path === targetPath || worktree.worktreePath === targetPath) &&
      typeof worktree.branch === "string" &&
      worktree.branch.trim() !== "",
  );

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const executeHerdr: HerdrCommandExecutor = async (args, signal) => {
  try {
    const result = await executeHostCommand({
      command: "herdr",
      args,
      ...(signal === undefined ? {} : { signal }),
    });
    return result.exitCode === 0
      ? { ok: true, stdout: result.stdout }
      : {
          ok: false,
          message: result.stderr.trim() || `Herdr exited with status ${result.exitCode}.`,
        };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
