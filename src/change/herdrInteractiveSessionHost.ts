import { executeHostCommand } from "../command/hostCommand.js";

import { prependAgentEnvironment, shellQuote } from "../agent/agentEnvironment.js";
import { piResourceFlags } from "../agent/piRuntime.js";
import type {
  InteractiveSessionHost,
  InteractiveSessionLaunchInput,
  InteractiveSessionLaunchResult,
  InteractiveSessionLaunchEvidence,
} from "./interactiveSessionHost.js";

export type HerdrCommandExecutor = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<
  { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly message: string }
>;

export type HerdrInteractiveSessionHostOptions = {
  readonly path?: string;
  readonly commandTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly readinessPollMs?: number;
  readonly observationRetries?: number;
};

type ResolvedOptions = {
  readonly commandTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly readinessPollMs: number;
  readonly observationRetries: number;
};

const defaultOptions = {
  commandTimeoutMs: 5_000,
  readinessTimeoutMs: 5_000,
  readinessPollMs: 100,
  observationRetries: 2,
} as const;

export const openHerdrInteractiveSessionHost = (
  execute: HerdrCommandExecutor = executeHerdr,
  environment: HerdrInteractiveSessionHostOptions = {},
): InteractiveSessionHost => ({
  launch: async (input, signal) => launchHerdrSession(execute, input, environment, signal),
});

export const herdrSessionName = (changeId: string): string => `but-why-${changeId}`;

const launchHerdrSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  environment: HerdrInteractiveSessionHostOptions,
  signal: AbortSignal | undefined,
): Promise<InteractiveSessionLaunchResult> => {
  const options = { ...defaultOptions, ...environment };
  const command = boundedExecutor(execute, options.commandTimeoutMs);
  const sessionName = herdrSessionName(input.changeId);
  const agents = await observe(command, ["agent", "list"], signal, options.observationRetries);
  if (!agents.ok) {
    return {
      ok: false,
      code: "host_unavailable",
      message: `Start Herdr before launching ${sessionName}: ${agents.message}`,
    };
  }
  if (hasActiveSession(agents.stdout, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
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
  let worktree = await command(worktreeArgs, signal);
  if (!worktree.ok && worktree.message.includes("timed out")) {
    const state = await observe(
      command,
      ["worktree", "list", "--cwd", input.worktreePath, "--json"],
      signal,
      options.observationRetries,
    );
    if (state.ok) worktree = await command(worktreeArgs, signal);
  }
  if (!worktree.ok) {
    return worktree.message.includes("timed out")
      ? launchIndeterminate(
          `Herdr did not confirm opening the Managed Worktree: ${worktree.message}`,
        )
      : launchFailure(worktree.message);
  }
  const opened = openedWorktree(worktree.stdout);
  if (opened === undefined) {
    return launchFailure("Herdr did not return a worktree root pane.");
  }
  return launchInOpenedWorktree(
    command,
    input,
    environment.path,
    sessionName,
    agents.stdout,
    opened,
    signal,
    options,
  );
};

const launchInOpenedWorktree = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  path: string | undefined,
  sessionName: string,
  listedAgents: string,
  opened: OpenedWorktree,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<InteractiveSessionLaunchResult> => {
  if (opened.alreadyOpen && hasActiveAgentInWorktree(listedAgents, input)) {
    return launchFailure("Another Interactive Session is already active in this worktree.");
  }

  const launched = await execute(
    ["pane", "run", opened.rootPaneId, piCommand(input, path)],
    signal,
  );
  if (!launched.ok) {
    const observed = launched.message.includes("timed out")
      ? await waitForSession(execute, input, sessionName, signal, options)
      : ({ kind: "absent" } as const);
    if (observed.kind === "ready") {
      return { ok: true, host: "herdr", status: "started" };
    }
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    if (!opened.alreadyOpen && observed.kind === "absent") {
      await closeWorkspace(execute, opened.workspaceId, signal);
    }
    return observed.kind === "exited"
      ? launchFailure(`Pi exited during startup: ${observed.message}`, evidence)
      : launched.message.includes("timed out")
        ? launchIndeterminate(
            `Herdr did not confirm whether Pi started: ${launched.message}`,
            evidence,
          )
        : launchFailure(launched.message, evidence);
  }

  const renamed = await execute(["agent", "rename", opened.rootPaneId, sessionName], signal);
  const renameConfirmed =
    renamed.ok && renamedSession(renamed.stdout, input, sessionName, opened.rootPaneId);
  if (!renameConfirmed) {
    const renamedState = await observe(
      execute,
      ["agent", "list"],
      signal,
      options.observationRetries,
    );
    if (
      !renamedState.ok ||
      !renamedSession(renamedState.stdout, input, sessionName, opened.rootPaneId)
    ) {
      if (!renamed.ok && renamed.message.includes("timed out")) {
        const retried = await execute(["agent", "rename", opened.rootPaneId, sessionName], signal);
        if (retried.ok && renamedSession(retried.stdout, input, sessionName, opened.rootPaneId)) {
          return { ok: true, host: "herdr", status: "started" };
        }
      }
      await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"], signal);
      if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
      return launchFailure(
        renamed.ok
          ? "Herdr did not confirm the named Pi session in the worktree root pane."
          : renamed.message,
      );
    }
  }
  const ready = await waitForSession(
    execute,
    input,
    sessionName,
    signal,
    options,
    true,
    opened.alreadyOpen && hasDoneAgent(listedAgents, input, sessionName),
  );
  if (ready.kind === "exited") {
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
    return launchFailure(`Pi exited during startup: ${ready.message}`, evidence);
  }
  if (ready.kind === "unknown" || ready.kind === "absent") {
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    return launchIndeterminate("Herdr did not confirm Pi readiness before the deadline.", evidence);
  }
  return { ok: true, host: "herdr", status: "started" };
};

const launchFailure = (
  message: string,
  evidence?: InteractiveSessionLaunchEvidence,
): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_failed",
  message: `Herdr could not launch the Interactive Session: ${message}`,
  ...(evidence === undefined ? {} : { evidence }),
});

const launchIndeterminate = (
  message: string,
  evidence?: InteractiveSessionLaunchEvidence,
): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_indeterminate",
  message: `Herdr could not prove that the Interactive Session launched: ${message}`,
  ...(evidence === undefined ? {} : { evidence }),
});

type SessionObservation =
  | { readonly kind: "ready" }
  | { readonly kind: "exited"; readonly message: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

const waitForSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
  fallbackReady = false,
  ignoreDone = false,
): Promise<SessionObservation> => {
  const deadline = performance.now() + options.readinessTimeoutMs;
  let last: SessionObservation = { kind: "absent" };
  do {
    const listed = await observe(execute, ["agent", "list"], signal, options.observationRetries);
    if (!listed.ok) {
      last = { kind: "unknown" };
    } else {
      const agent = findSession(listed.stdout, input, sessionName);
      if (agent === undefined) {
        if (fallbackReady) return { kind: "ready" };
        last = { kind: "absent" };
      } else if (isActiveAgentStatus(recordValue(agent, "agent_status"))) {
        return { kind: "ready" };
      } else if (recordValue(agent, "agent_status") === "done") {
        if (ignoreDone) return { kind: "ready" };
        return { kind: "exited", message: "Herdr reported the hosted process as done." };
      } else {
        last = { kind: "unknown" };
      }
    }
    if (performance.now() >= deadline) break;
    await delay(
      Math.min(options.readinessPollMs, Math.max(0, deadline - performance.now())),
      signal,
    );
  } while (performance.now() < deadline);
  return last;
};

const findSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): Record<string, unknown> | undefined => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return Array.isArray(agents)
    ? (agents.find((agent) => matchesSession(agent, input, sessionName, undefined, false)) as
        | Record<string, unknown>
        | undefined)
    : undefined;
};

const observe = async (
  execute: HerdrCommandExecutor,
  args: readonly string[],
  signal: AbortSignal | undefined,
  retries: number,
): Promise<Awaited<ReturnType<HerdrCommandExecutor>>> => {
  let result = await execute(args, signal);
  for (let attempt = 0; !result.ok && attempt < retries; attempt += 1) {
    result = await execute(args, signal);
  }
  return result;
};

const delay = (milliseconds: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });

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

const launchEvidence = async (
  execute: HerdrCommandExecutor,
  paneId: string,
  signal: AbortSignal | undefined,
): Promise<InteractiveSessionLaunchEvidence | undefined> => {
  const [output, processInfo] = await Promise.all([
    execute(
      [
        "pane",
        "read",
        paneId,
        "--source",
        "recent-unwrapped",
        "--lines",
        "200",
        "--format",
        "text",
      ],
      signal,
    ),
    execute(["pane", "process-info", "--pane", paneId], signal),
  ]);
  const startupOutput = output.ok && output.stdout.trim() !== "" ? output.stdout.trim() : undefined;
  const exitEvidence =
    processInfo.ok && processInfo.stdout.trim() !== "" ? processInfo.stdout.trim() : undefined;
  return startupOutput === undefined && exitEvidence === undefined
    ? undefined
    : {
        ...(startupOutput === undefined ? {} : { startupOutput }),
        ...(exitEvidence === undefined ? {} : { exitEvidence }),
      };
};

const piCommand = (input: InteractiveSessionLaunchInput, path: string | undefined): string => {
  const profileFlags =
    input.agentProfile === undefined
      ? ""
      : piResourceFlags(input.agentProfile.profile.runtimeConfig, {
          scope: input.agentProfile.scope,
          repoRoot: input.worktreePath,
          globalConfigDirectory: input.globalConfigDirectory,
        });
  const model = input.agentProfile?.profile.runtimeConfig?.model;
  const thinking = input.agentProfile?.profile.runtimeConfig?.thinking;
  return [
    ...(path === undefined ? [] : [`PATH=${shellQuote(path)}`]),
    `exec ${prependAgentEnvironment("pi", input.agentEnvironment)}`,
    "--name",
    shellQuote(herdrSessionName(input.changeId)),
    ...(model === undefined ? [] : ["--model", shellQuote(model)]),
    ...(thinking === undefined ? [] : ["--thinking", shellQuote(thinking)]),
    ...(profileFlags.length === 0 ? [] : [profileFlags]),
    shellQuote(piInitialPrompt(input.initialPrompt)),
  ].join(" ");
};

const piInitialPrompt = (prompt: string | undefined): string => {
  const value = prompt ?? "";
  return value.startsWith("---") ? `\n${value}` : value;
};

const hasActiveSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return (
    Array.isArray(agents) &&
    agents.some((agent) => matchesSession(agent, input, sessionName, undefined, true))
  );
};

const hasDoneAgent = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => {
  const agent = findSession(source, input, sessionName);
  return agent !== undefined && recordValue(agent, "agent_status") === "done";
};

const hasActiveAgentInWorktree = (
  source: string,
  input: InteractiveSessionLaunchInput,
): boolean => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return (
    Array.isArray(agents) &&
    agents.some(
      (agent) =>
        isRecord(agent) &&
        recordValue(agent, "cwd") === input.worktreePath &&
        isActiveAgentStatus(recordValue(agent, "agent_status")),
    )
  );
};

const renamedSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  rootPaneId: string,
): boolean => {
  const result = herdrResult(source);
  const agent = result === undefined ? undefined : recordValue(result, "agent");
  return matchesSession(agent, input, sessionName, rootPaneId, false);
};

const matchesSession = (
  value: unknown,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  paneId: string | undefined,
  requireActive: boolean,
): boolean => {
  if (!isRecord(value)) return false;
  const name = recordValue(value, "name");
  const agent = recordValue(value, "agent");
  const cwd = recordValue(value, "cwd");
  const reportedPaneId = recordValue(value, "pane_id");
  const status = recordValue(value, "agent_status");
  return (
    (name === sessionName || agent === sessionName) &&
    cwd === input.worktreePath &&
    (paneId === undefined || reportedPaneId === paneId) &&
    (!requireActive || isActiveAgentStatus(status))
  );
};

const isActiveAgentStatus = (status: unknown): boolean =>
  status === "idle" || status === "working" || status === "blocked" || status === "unknown";

const closeWorkspace = async (
  execute: HerdrCommandExecutor,
  workspaceId: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  await execute(["workspace", "close", workspaceId], signal);
};

type OpenedWorktree = {
  readonly workspaceId: string;
  readonly rootPaneId: string;
  readonly alreadyOpen: boolean;
};

const openedWorktree = (source: string): OpenedWorktree | undefined => {
  const result = herdrResult(source);
  const workspace = result === undefined ? undefined : recordValue(result, "workspace");
  const rootPane = result === undefined ? undefined : recordValue(result, "root_pane");
  const workspaceId = isRecord(workspace) ? recordValue(workspace, "workspace_id") : undefined;
  const rootPaneId = isRecord(rootPane) ? recordValue(rootPane, "pane_id") : undefined;
  const alreadyOpen = result === undefined ? undefined : recordValue(result, "already_open");
  return typeof workspaceId === "string" &&
    typeof rootPaneId === "string" &&
    typeof alreadyOpen === "boolean"
    ? { workspaceId, rootPaneId, alreadyOpen }
    : undefined;
};

const herdrResult = (source: string): Record<string, unknown> | undefined => {
  const response = parseJson(source);
  const result = isRecord(response) ? recordValue(response, "result") : undefined;
  return isRecord(result) ? result : undefined;
};

const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const recordValue = (record: Record<string, unknown>, key: string): unknown => record[key];

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
