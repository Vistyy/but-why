import { readFileSync, statSync } from "node:fs";
import { Either, Schema } from "effect";
import { createJiti } from "jiti/static";

import { piResourceArgs } from "../../../agent/piRuntime.js";
import { executeHostCommand } from "../../../command/hostCommand.js";
import { resolvePackageAsset } from "../../packageAssetPath.js";
import type {
  InteractiveSessionHost,
  InteractiveSessionLaunchInput,
  InteractiveSessionLaunchResult,
} from "../interactiveSessionHost.js";
import { type HerdrAgentPromptTransport, sendHerdrAgentPrompt } from "./herdrAgentPromptSocket.js";

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
  readonly socketPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly promptTransport?: HerdrAgentPromptTransport;
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

type LaunchPhaseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly result: InteractiveSessionLaunchResult };
type ExistingSessionState = "done" | undefined;

const phaseComplete = <Value>(value: Value): LaunchPhaseResult<Value> => ({ ok: true, value });

const phaseStopped = <Value>(result: InteractiveSessionLaunchResult): LaunchPhaseResult<Value> => ({
  ok: false,
  result,
});

const launchHerdrSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  environment: HerdrInteractiveSessionHostOptions,
  signal: AbortSignal | undefined,
): Promise<InteractiveSessionLaunchResult> => {
  const options = { ...defaultOptions, ...environment };
  const preflight = await preflightTrustedResources(input);
  if (!preflight.ok) return preflight.result;
  const socketPath = environment.socketPath;
  const platform = environment.platform;
  if (platform === undefined) {
    return {
      ok: false,
      code: "host_unavailable",
      message: "The Interactive Session runtime platform is unavailable.",
    };
  }
  if (socketPath === undefined && environment.promptTransport === undefined) {
    return {
      ok: false,
      code: "host_unavailable",
      message: "Start Change Implement from a Herdr-managed pane with HERDR_SOCKET_PATH set.",
    };
  }
  const promptTransport = environment.promptTransport ?? sendHerdrAgentPrompt;

  const command = boundedExecutor(execute, options.commandTimeoutMs);
  const sessionName = input.hostSessionName ?? herdrSessionName(input.changeId);
  const existingSession = await observeExistingSession(
    command,
    input,
    sessionName,
    signal,
    options,
  );
  if (!existingSession.ok) return existingSession.result;
  if (existingSession.value === "done") {
    return submitInitialPrompt(
      command,
      promptTransport,
      socketPath ?? "injected",
      platform,
      input,
      sessionName,
      signal,
      options,
    );
  }

  const openedWorkspace = await openStandaloneWorkspace(
    command,
    input,
    sessionName,
    signal,
    options,
  );
  if (!openedWorkspace.ok) return openedWorkspace.result;

  const nativeAgent = await startNativeAgent(
    execute,
    command,
    input,
    sessionName,
    preflight.value.continuationExtension,
    openedWorkspace.value,
    signal,
    options,
  );
  if (!nativeAgent.ok) return nativeAgent.result;

  return submitInitialPrompt(
    command,
    promptTransport,
    socketPath ?? "injected",
    platform,
    input,
    sessionName,
    signal,
    options,
  );
};

const preflightTrustedResources = async (
  input: InteractiveSessionLaunchInput,
): Promise<LaunchPhaseResult<{ readonly continuationExtension: string }>> => {
  const continuationExtension = trustedContinuationExtensionPath();
  const extensionPreflight = await preflightTrustedExtension(continuationExtension);
  if (!extensionPreflight.ok) return phaseStopped(launchFailure(extensionPreflight.message));
  for (const [index, path] of input.systemPromptPaths.entries()) {
    const promptPreflight = preflightFile(
      path,
      `Required packaged system-prompt resource ${index + 1}`,
    );
    if (!promptPreflight.ok) return phaseStopped(launchFailure(promptPreflight.message));
  }
  return phaseComplete({ continuationExtension });
};

const observeExistingSession = async (
  command: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<LaunchPhaseResult<ExistingSessionState>> => {
  const existing = await observe(command, ["agent", "list"], signal, options.observationRetries);
  if (!existing.ok) {
    return phaseStopped({
      ok: false,
      code: "host_unavailable",
      message: `Start Herdr before launching ${sessionName}: ${existing.message}`,
    });
  }
  const existingAgents = decodeAgentList(existing.stdout);
  if (existingAgents === undefined) {
    return phaseStopped(launchFailure("Herdr returned malformed agent-list output."));
  }
  if (hasActiveSession(existingAgents, sessionName)) {
    return phaseStopped({ ok: true, host: "herdr", status: "already_active" });
  }
  if (
    hasUnknownSession(existingAgents, sessionName) ||
    hasUnknownAgentInWorktree(existingAgents, input)
  ) {
    return phaseStopped(
      launchIndeterminate("Herdr could not determine the existing session state."),
    );
  }
  if (hasCompletedSession(existingAgents, sessionName)) {
    if (hasActiveAgentInWorktree(existingAgents, input)) {
      return phaseStopped(
        launchFailure("Another Interactive Session is already active in this Managed Worktree."),
      );
    }
    return phaseComplete("done");
  }
  return phaseComplete(undefined);
};

const openStandaloneWorkspace = async (
  command: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<LaunchPhaseResult<OpenedWorkspace>> => {
  const before = await observe(command, ["workspace", "list"], signal, options.observationRetries);
  const existingWorkspaces = before.ok ? decodeWorkspaceList(before.stdout) : undefined;
  if (existingWorkspaces === undefined) {
    return phaseStopped(
      launchIndeterminate("Herdr did not provide a trustworthy pre-creation workspace list."),
    );
  }
  const matchingWorkspaces = existingWorkspaces.filter(
    (workspace) => workspace.label === sessionName,
  );
  if (matchingWorkspaces.length > 1) {
    return phaseStopped(
      launchIndeterminate("Herdr reported multiple workspaces for this Interactive Session."),
    );
  }
  const matchingWorkspace = matchingWorkspaces[0];
  if (matchingWorkspace !== undefined) {
    const recovered = await observeWorkspaceRootPane(
      command,
      matchingWorkspace.workspaceId,
      signal,
      options,
    );
    return recovered === undefined
      ? phaseStopped(
          launchIndeterminate(
            "Herdr did not identify the existing Interactive Session workspace root pane.",
          ),
        )
      : phaseComplete(recovered);
  }

  const created = await command(
    ["workspace", "create", "--cwd", input.worktreePath, "--label", sessionName, "--no-focus"],
    signal,
  );
  if (created.ok) {
    const workspace = decodeCreatedWorkspace(created.stdout);
    return workspace === undefined
      ? phaseStopped(launchIndeterminate("Herdr returned malformed workspace-create output."))
      : phaseComplete(workspace);
  }
  if (!isUncertainMutationFailure(created.message)) {
    return phaseStopped(launchFailure(created.message));
  }

  const after = await observe(command, ["workspace", "list"], signal, options.observationRetries);
  const recoveredWorkspaceId = after.ok
    ? decodeNewWorkspaceId(
        after.stdout,
        existingWorkspaces.map((workspace) => workspace.workspaceId),
        sessionName,
      )
    : undefined;
  if (recoveredWorkspaceId === undefined) {
    return phaseStopped(
      launchIndeterminate(`Herdr did not confirm creating the workspace: ${created.message}`),
    );
  }
  const recovered = await observeWorkspaceRootPane(command, recoveredWorkspaceId, signal, options);
  return recovered === undefined
    ? phaseStopped(
        launchIndeterminate(
          `Herdr created a workspace but did not identify its root pane: ${created.message}`,
        ),
      )
    : phaseComplete(recovered);
};

const observeWorkspaceRootPane = async (
  command: HerdrCommandExecutor,
  workspaceId: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<OpenedWorkspace | undefined> => {
  const panes = await observe(
    command,
    ["pane", "list", "--workspace", workspaceId],
    signal,
    options.observationRetries,
  );
  return panes.ok ? decodeSoleWorkspacePane(panes.stdout, workspaceId) : undefined;
};

const startNativeAgent = async (
  execute: HerdrCommandExecutor,
  command: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  continuationExtension: string,
  opened: OpenedWorkspace,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<LaunchPhaseResult<void>> => {
  const beforeStart = await observe(command, ["agent", "list"], signal, options.observationRetries);
  const beforeStartAgents = beforeStart.ok ? decodeAgentList(beforeStart.stdout) : undefined;
  if (beforeStartAgents === undefined) {
    return phaseStopped(
      launchIndeterminate("Herdr did not provide a trustworthy pre-start session observation."),
    );
  }
  if (hasActiveSession(beforeStartAgents, sessionName)) {
    return phaseStopped({ ok: true, host: "herdr", status: "already_active" });
  }
  if (
    hasUnknownSession(beforeStartAgents, sessionName) ||
    hasUnknownAgentInWorktree(beforeStartAgents, input, opened.workspaceId)
  ) {
    return phaseStopped(
      launchIndeterminate("Herdr could not determine the existing session state."),
    );
  }
  if (hasActiveAgentInWorktree(beforeStartAgents, input, opened.workspaceId)) {
    return phaseStopped(
      launchFailure("Another Interactive Session is already active in this Managed Worktree."),
    );
  }
  if (hasCompletedSession(beforeStartAgents, sessionName)) {
    return phaseComplete(undefined);
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
  if (started.paneReadinessTimedOut) {
    return phaseStopped(paneNotReady(options.readinessTimeoutMs));
  }
  const startResult = started.result;
  const startConfirmed = startResult.ok && isConfirmedAgentStart(startResult.stdout);
  if (!startResult.ok && !isUncertainMutationFailure(startResult.message)) {
    return phaseStopped(launchFailure(startResult.message));
  }
  if (startConfirmed) return phaseComplete(undefined);

  const afterStart = await observe(command, ["agent", "list"], signal, options.observationRetries);
  const afterStartAgents = afterStart.ok ? decodeAgentList(afterStart.stdout) : undefined;
  if (afterStartAgents !== undefined) {
    if (hasActiveSession(afterStartAgents, sessionName)) return phaseComplete(undefined);
    if (
      hasUnknownSession(afterStartAgents, sessionName) ||
      hasUnknownAgentInWorktree(afterStartAgents, input, opened.workspaceId)
    ) {
      return phaseStopped(
        launchIndeterminate("Herdr reported an unknown state after native agent start."),
      );
    }
    if (hasActiveAgentInWorktree(afterStartAgents, input, opened.workspaceId)) {
      return phaseStopped(
        launchFailure("Another Interactive Session is already active in this Managed Worktree."),
      );
    }
    if (hasCompletedSession(afterStartAgents, sessionName)) {
      return phaseComplete(undefined);
    }
  }
  return phaseStopped(
    launchIndeterminate(
      startResult.ok
        ? "Herdr did not confirm that native Pi startup reached readiness."
        : `Herdr did not confirm whether native Pi startup succeeded: ${startResult.message}`,
    ),
  );
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
  promptTransport: HerdrAgentPromptTransport,
  socketPath: string,
  platform: NodeJS.Platform,
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
  const prompted = await promptTransport({
    socketPath,
    platform,
    target: sessionName,
    text: input.initialPrompt,
    timeoutMs: options.commandTimeoutMs,
    ...(signal === undefined ? {} : { signal }),
  });
  if (prompted.ok) return { ok: true, host: "herdr", status: "started" };
  if (prompted.transmission === "none") {
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
    "--append-system-prompt",
    systemPrompt,
    "--append-system-prompt",
    implementationInstructions,
    "--name",
    input.changeId,
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

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter((value) => value.length > 0));
const nonBlankStringSchema = Schema.String.pipe(Schema.filter((value) => value.trim().length > 0));

const herdrAgentStatusSchema = Schema.Literal("idle", "working", "blocked", "unknown", "done");
const herdrAgentSchema = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  workspace_id: Schema.optional(nonBlankStringSchema),
  agent_status: herdrAgentStatusSchema,
  pane_id: Schema.String,
  name: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
});

const herdrAgentListResponseSchema = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("agent_list"),
    agents: Schema.Array(herdrAgentSchema),
  }),
});

const herdrWorkspaceListResponseSchema = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("workspace_list"),
    workspaces: Schema.Array(
      Schema.Struct({
        workspace_id: nonBlankStringSchema,
        label: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const herdrWorkspaceCreatedResponseSchema = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("workspace_created"),
    workspace: Schema.Struct({ workspace_id: nonBlankStringSchema }),
    tab: Schema.Struct({
      tab_id: nonBlankStringSchema,
      workspace_id: nonBlankStringSchema,
    }),
    root_pane: Schema.Struct({
      pane_id: nonBlankStringSchema,
      workspace_id: nonBlankStringSchema,
      tab_id: nonBlankStringSchema,
    }),
  }),
});

const herdrPaneListResponseSchema = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("pane_list"),
    panes: Schema.Array(
      Schema.Struct({
        pane_id: nonBlankStringSchema,
        workspace_id: nonBlankStringSchema,
      }),
    ),
  }),
});

const herdrAgentStartedResponseSchema = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("agent_started"),
    agent: Schema.Struct({ terminal_id: nonEmptyStringSchema }),
  }),
});

const herdrErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.String }),
});

type HerdrAgentStatus = Schema.Schema.Type<typeof herdrAgentStatusSchema>;
type HerdrAgent = Schema.Schema.Type<typeof herdrAgentSchema>;
type HerdrWorkspaceSummary = { readonly workspaceId: string; readonly label?: string };
type OpenedWorkspace = { readonly workspaceId: string; readonly rootPaneId: string };

const decodeHerdrJson = <A, I>(source: string, schema: Schema.Schema<A, I>): A | undefined => {
  let input: unknown;
  try {
    input = JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
  const decoded = Schema.decodeUnknownEither(schema, { onExcessProperty: "ignore" })(input);
  return Either.isRight(decoded) ? decoded.right : undefined;
};

const decodeAgentList = (source: string): readonly HerdrAgent[] | undefined =>
  decodeHerdrJson(source, herdrAgentListResponseSchema)?.result.agents;

const decodeWorkspaceList = (source: string): readonly HerdrWorkspaceSummary[] | undefined =>
  decodeHerdrJson(source, herdrWorkspaceListResponseSchema)?.result.workspaces.map((workspace) => ({
    workspaceId: workspace.workspace_id,
    ...(workspace.label === undefined ? {} : { label: workspace.label }),
  }));

const decodeNewWorkspaceId = (
  source: string,
  existingWorkspaceIds: readonly string[],
  expectedLabel: string,
): string | undefined => {
  const response = decodeHerdrJson(source, herdrWorkspaceListResponseSchema);
  if (response === undefined) return undefined;
  const existing = new Set(existingWorkspaceIds);
  const matches = response.result.workspaces.filter(
    (workspace) => !existing.has(workspace.workspace_id) && workspace.label === expectedLabel,
  );
  return matches.length === 1 ? matches[0]?.workspace_id : undefined;
};

const decodeCreatedWorkspace = (source: string): OpenedWorkspace | undefined => {
  const response = decodeHerdrJson(source, herdrWorkspaceCreatedResponseSchema);
  if (response === undefined) return undefined;
  const { root_pane: rootPane, tab, workspace } = response.result;
  return tab.workspace_id === workspace.workspace_id &&
    rootPane.workspace_id === workspace.workspace_id &&
    rootPane.tab_id === tab.tab_id
    ? { workspaceId: workspace.workspace_id, rootPaneId: rootPane.pane_id }
    : undefined;
};

const decodeSoleWorkspacePane = (
  source: string,
  workspaceId: string,
): OpenedWorkspace | undefined => {
  const response = decodeHerdrJson(source, herdrPaneListResponseSchema);
  if (response === undefined || response.result.panes.length !== 1) return undefined;
  const pane = response.result.panes[0];
  return pane?.workspace_id === workspaceId ? { workspaceId, rootPaneId: pane.pane_id } : undefined;
};

const decodeAgentStarted = (source: string): { readonly terminalId: string } | undefined => {
  const response = decodeHerdrJson(source, herdrAgentStartedResponseSchema);
  return response === undefined ? undefined : { terminalId: response.result.agent.terminal_id };
};

const isAgentPaneBusyFailure = (message: string): boolean => {
  const trimmed = message.trim();
  if (trimmed.split(/[:\s]/, 1)[0] === "agent_pane_busy") return true;
  return decodeHerdrJson(trimmed, herdrErrorResponseSchema)?.error.code === "agent_pane_busy";
};

const hasActiveSession = (agents: readonly HerdrAgent[], sessionName: string): boolean => {
  const status = findSession(agents, sessionName)?.agent_status;
  return status !== undefined && isActiveAgentStatus(status);
};

const hasCompletedSession = (agents: readonly HerdrAgent[], sessionName: string): boolean =>
  findSession(agents, sessionName)?.agent_status === "done";

const hasUnknownSession = (agents: readonly HerdrAgent[], sessionName: string): boolean =>
  findSession(agents, sessionName)?.agent_status === "unknown";

const findSession = (agents: readonly HerdrAgent[], sessionName: string): HerdrAgent | undefined =>
  agents.find((agent) => agent.name === sessionName || agent.agent === sessionName);

const isAgentInWorktree = (
  agent: HerdrAgent,
  input: InteractiveSessionLaunchInput,
  workspaceId?: string,
): boolean =>
  agent.cwd === input.worktreePath ||
  (workspaceId !== undefined && agent.workspace_id === workspaceId);

const hasUnknownAgentInWorktree = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
  workspaceId?: string,
): boolean =>
  agents.some(
    (agent) => isAgentInWorktree(agent, input, workspaceId) && agent.agent_status === "unknown",
  );

const hasActiveAgentInWorktree = (
  agents: readonly HerdrAgent[],
  input: InteractiveSessionLaunchInput,
  workspaceId?: string,
): boolean =>
  agents.some(
    (agent) =>
      isAgentInWorktree(agent, input, workspaceId) && isActiveAgentStatus(agent.agent_status),
  );

const isActiveAgentStatus = (status: HerdrAgentStatus): boolean =>
  status === "idle" || status === "working" || status === "blocked";

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
