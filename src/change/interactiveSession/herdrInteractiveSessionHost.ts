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
  if (!isValidAgentList(existing.stdout))
    return launchFailure("Herdr returned malformed agent-list output.");
  if (hasActiveSession(existing.stdout, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (
    hasUnknownSession(existing.stdout, input, sessionName) ||
    hasUnknownAgentInWorktree(existing.stdout, input)
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
    if (!worktreeState.ok || !worktreeMatchesTarget(worktreeState.stdout, input.worktreePath)) {
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
  const opened = openedWorktree(openedResult.stdout);
  if (opened === undefined)
    return launchIndeterminate("Herdr returned malformed worktree-open output.");

  const beforeStart = await observe(command, ["agent", "list"], signal, options.observationRetries);
  if (!beforeStart.ok || !isValidAgentList(beforeStart.stdout)) {
    return launchIndeterminate(
      "Herdr did not provide a trustworthy pre-start session observation.",
    );
  }
  if (hasActiveSession(beforeStart.stdout, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (
    hasUnknownSession(beforeStart.stdout, input, sessionName) ||
    hasUnknownAgentInWorktree(beforeStart.stdout, input)
  ) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }
  if (hasActiveAgentInWorktree(beforeStart.stdout, input)) {
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
    if (afterStart.ok && isValidAgentList(afterStart.stdout)) {
      if (hasActiveSession(afterStart.stdout, input, sessionName)) {
        return submitInitialPrompt(command, input, sessionName, signal, options);
      }
      if (hasUnknownSession(afterStart.stdout, input, sessionName)) {
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
    observed.ok && isValidAgentList(observed.stdout)
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

const isConfirmedAgentStart = (source: string): boolean => {
  const result = herdrResult(source);
  return (
    result !== undefined &&
    result.type === "agent_started" &&
    typeof result.terminal_id === "string" &&
    result.terminal_id.length > 0
  );
};

const isConfirmedAgentPrompt = (source: string): boolean =>
  herdrResult(source)?.type === "agent_prompted";

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

const isAgentPaneBusyFailure = (message: string): boolean => {
  const trimmed = message.trim();
  if (trimmed.split(/[:\s]/, 1)[0] === "agent_pane_busy") return true;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) && isRecord(parsed.error) && parsed.error.code === "agent_pane_busy";
  } catch {
    return false;
  }
};

type JsonRecord = Record<string, unknown> & {
  readonly type?: unknown;
  readonly error?: unknown;
  readonly code?: unknown;
  readonly terminal_id?: unknown;
  readonly result?: unknown;
  readonly agents?: unknown;
  readonly cwd?: unknown;
  readonly agent_status?: unknown;
  readonly pane_id?: unknown;
  readonly name?: unknown;
  readonly agent?: unknown;
  readonly worktrees?: unknown;
  readonly path?: unknown;
  readonly worktree_path?: unknown;
  readonly branch?: unknown;
  readonly workspace?: unknown;
  readonly root_pane?: unknown;
  readonly workspace_id?: unknown;
};

const herdrResult = (source: string): JsonRecord | undefined => {
  try {
    const response = JSON.parse(source) as unknown;
    if (!isRecord(response) || !isRecord(response.result)) return undefined;
    return response.result;
  } catch {
    return undefined;
  }
};

const isValidAgentList = (source: string): boolean => {
  const result = herdrResult(source);
  return (
    result?.type === "agent_list" &&
    Array.isArray(result.agents) &&
    result.agents.every(
      (agent: unknown) =>
        isRecord(agent) &&
        typeof agent.cwd === "string" &&
        typeof agent.agent_status === "string" &&
        ["idle", "working", "blocked", "unknown", "done"].includes(agent.agent_status) &&
        typeof agent.pane_id === "string" &&
        (agent.name === undefined || typeof agent.name === "string") &&
        (agent.agent === undefined || typeof agent.agent === "string"),
    )
  );
};

const hasActiveSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => {
  const status = findSession(source, input, sessionName)?.agent_status;
  return status !== undefined && isActiveAgentStatus(status);
};

const hasUnknownSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => findSession(source, input, sessionName)?.agent_status === "unknown";

const findSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): JsonRecord | undefined => {
  const agents = herdrResult(source)?.agents;
  return Array.isArray(agents)
    ? (agents.find(
        (agent: unknown) =>
          isRecord(agent) &&
          (agent.name === sessionName || agent.agent === sessionName) &&
          agent.cwd === input.worktreePath,
      ) as JsonRecord | undefined)
    : undefined;
};

const hasUnknownAgentInWorktree = (
  source: string,
  input: InteractiveSessionLaunchInput,
): boolean => {
  const result = herdrResult(source);
  return (
    Array.isArray(result?.agents) &&
    result.agents.some(
      (agent: unknown) =>
        isRecord(agent) && agent.cwd === input.worktreePath && agent.agent_status === "unknown",
    )
  );
};

const hasActiveAgentInWorktree = (
  source: string,
  input: InteractiveSessionLaunchInput,
): boolean => {
  const result = herdrResult(source);
  return (
    Array.isArray(result?.agents) &&
    result.agents.some(
      (agent: unknown) =>
        isRecord(agent) &&
        agent.cwd === input.worktreePath &&
        isActiveAgentStatus(agent.agent_status),
    )
  );
};

const isActiveAgentStatus = (status: unknown): boolean =>
  status === "idle" || status === "working" || status === "blocked";

const worktreeMatchesTarget = (source: string, targetPath: string): boolean => {
  const result = herdrResult(source);
  return (
    result?.type === "worktree_list" &&
    Array.isArray(result.worktrees) &&
    result.worktrees.some(
      (worktree: unknown) =>
        isRecord(worktree) &&
        (worktree.path === targetPath || worktree.worktree_path === targetPath) &&
        typeof worktree.branch === "string" &&
        worktree.branch.trim() !== "",
    )
  );
};

type OpenedWorktree = {
  readonly rootPaneId: string;
};

const openedWorktree = (source: string): OpenedWorktree | undefined => {
  const result = herdrResult(source);
  if (result?.type !== "worktree_opened") return undefined;
  const workspace = isRecord(result.workspace) ? result.workspace : undefined;
  const rootPane = isRecord(result.root_pane) ? result.root_pane : undefined;
  return typeof workspace?.workspace_id === "string" && typeof rootPane?.pane_id === "string"
    ? { rootPaneId: rootPane.pane_id }
    : undefined;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null;

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
