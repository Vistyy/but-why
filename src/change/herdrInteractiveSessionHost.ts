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
  let agents = await observe(command, ["agent", "list"], signal, options.observationRetries);
  if (!agents.ok) {
    return {
      ok: false,
      code: "host_unavailable",
      message: `Start Herdr before launching ${sessionName}: ${agents.message}`,
    };
  }
  if (!isValidAgentList(agents.stdout)) {
    return launchFailure("Herdr returned malformed agent-list output.");
  }
  if (hasActiveSession(agents.stdout, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (hasUnknownSession(agents.stdout, input, sessionName)) {
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
  let worktree = await command(worktreeArgs, signal);
  let recoveredWorktree = false;
  if (!worktree.ok && isUncertainMutationFailure(worktree.message)) {
    const state = await observe(
      command,
      ["worktree", "list", "--cwd", input.worktreePath, "--json"],
      signal,
      options.observationRetries,
    );
    if (state.ok && worktreeMatchesTarget(state.stdout, input.worktreePath, input.repositoryPath)) {
      agents = await observe(command, ["agent", "list"], signal, options.observationRetries);
      if (!agents.ok || !isValidAgentList(agents.stdout)) {
        return launchIndeterminate("Herdr did not provide session facts for worktree recovery.");
      }
      if (hasActiveSession(agents.stdout, input, sessionName)) {
        return { ok: true, host: "herdr", status: "already_active" };
      }
      if (hasUnknownSession(agents.stdout, input, sessionName)) {
        return launchIndeterminate("Herdr could not determine the existing session state.");
      }
      worktree = await command(worktreeArgs, signal);
      recoveredWorktree = true;
    }
  }
  if (recoveredWorktree) {
    agents = await observe(command, ["agent", "list"], signal, options.observationRetries);
    if (!agents.ok || !isValidAgentList(agents.stdout)) {
      return launchIndeterminate(
        "Herdr did not provide a trustworthy post-recovery session observation.",
      );
    }
    if (hasActiveSession(agents.stdout, input, sessionName)) {
      return { ok: true, host: "herdr", status: "already_active" };
    }
    if (hasUnknownSession(agents.stdout, input, sessionName)) {
      return launchIndeterminate("Herdr could not determine the existing session state.");
    }
  }
  if (!worktree.ok) {
    return isUncertainMutationFailure(worktree.message)
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
  if (hasUnknownSession(listedAgents, input, sessionName)) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }
  if (opened.alreadyOpen && hasActiveAgentInWorktree(listedAgents, input)) {
    return launchFailure("Another Interactive Session is already active in this worktree.");
  }

  const launched = await execute(
    ["pane", "run", opened.rootPaneId, piCommand(input, path)],
    signal,
  );
  if (!launched.ok) {
    const observed = isUncertainMutationFailure(launched.message)
      ? await waitForSession(execute, input, sessionName, opened.rootPaneId, signal, options)
      : ({ kind: "absent" } as const);
    if (observed.kind === "ready") {
      return { ok: true, host: "herdr", status: "started" };
    }
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    if (!opened.alreadyOpen && observed.kind === "absent") {
      await closeWorkspace(execute, opened.workspaceId, signal);
    }
    return observed.kind === "malformed"
      ? launchFailure(observed.message, evidence)
      : observed.kind === "exited"
        ? launchFailure(`Pi exited during startup: ${observed.message}`, evidence)
        : isUncertainMutationFailure(launched.message)
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
    if (!renamedState.ok || !isValidAgentList(renamedState.stdout)) {
      await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"], signal);
      if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
      return launchFailure("Herdr did not provide a safe rename reconciliation.");
    }
    if (renamedSession(renamedState.stdout, input, sessionName, opened.rootPaneId)) {
      // The mutation succeeded even though its response was lost.
    } else if (hasNamedAgentConflict(renamedState.stdout, sessionName, opened.rootPaneId)) {
      await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"], signal);
      if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
      return launchFailure("Herdr reported a naming conflict for the Interactive Session.");
    } else if (!renamed.ok && isUncertainMutationFailure(renamed.message)) {
      const retried = await execute(["agent", "rename", opened.rootPaneId, sessionName], signal);
      if (!retried.ok || !renamedSession(retried.stdout, input, sessionName, opened.rootPaneId)) {
        await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"], signal);
        if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
        return launchFailure(
          "Herdr did not confirm the named Pi session after retrying the rename.",
        );
      }
    } else {
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
    opened.rootPaneId,
    signal,
    options,
  );
  if (ready.kind === "malformed") {
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    return launchIndeterminate(ready.message, evidence);
  }
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
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed"; readonly message: string };

const waitForSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  paneId: string,
  signal: AbortSignal | undefined,
  options: ResolvedOptions,
): Promise<SessionObservation> => {
  const deadline = performance.now() + options.readinessTimeoutMs;
  let last: SessionObservation = { kind: "absent" };
  do {
    const listed = await observe(execute, ["agent", "list"], signal, options.observationRetries);
    if (!listed.ok) {
      last = { kind: "unknown" };
    } else if (!isValidAgentList(listed.stdout)) {
      return { kind: "malformed", message: "Herdr returned malformed agent-list output." };
    } else {
      const agent = findSession(listed.stdout, input, sessionName, paneId);
      if (agent === undefined) {
        last = { kind: "absent" };
      } else if (isActiveAgentStatus(recordValue(agent, "agent_status"))) {
        return { kind: "ready" };
      } else if (recordValue(agent, "agent_status") === "done") {
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
  paneId?: string,
): Record<string, unknown> | undefined => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return Array.isArray(agents)
    ? (agents.find((agent) => matchesSession(agent, input, sessionName, paneId, false)) as
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
  for (
    let attempt = 0;
    !result.ok && isTransientObservationFailure(result.message) && attempt < retries;
    attempt += 1
  ) {
    result = await execute(args, signal);
  }
  return result;
};

const delay = (milliseconds: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
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

const isTransientObservationFailure = (message: string): boolean =>
  /timed out|temporar|try again|connection reset|busy/i.test(message);

const isUncertainMutationFailure = (message: string): boolean =>
  /timed out|connection reset|ECONNRESET|response.*lost|lost response|no response|transport|connection.*closed|disconnected|broken pipe|eof/i.test(
    message,
  );

const isValidAgentList = (source: string): boolean => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return (
    Array.isArray(agents) &&
    agents.every(
      (agent) =>
        isRecord(agent) &&
        typeof recordValue(agent, "cwd") === "string" &&
        typeof recordValue(agent, "agent_status") === "string" &&
        ["idle", "working", "blocked", "unknown", "done"].includes(
          recordValue(agent, "agent_status") as string,
        ) &&
        (recordValue(agent, "name") === undefined ||
          typeof recordValue(agent, "name") === "string") &&
        (recordValue(agent, "agent") === undefined ||
          typeof recordValue(agent, "agent") === "string") &&
        typeof recordValue(agent, "pane_id") === "string",
    )
  );
};

const worktreeMatchesTarget = (
  source: string,
  targetPath: string,
  repositoryPath: string,
): boolean => {
  const response = parseJson(source);
  const result = isRecord(response) ? recordValue(response, "result") : undefined;
  const worktrees = isRecord(result) ? recordValue(result, "worktrees") : undefined;
  return (
    Array.isArray(worktrees) &&
    worktrees.some(
      (worktree) =>
        isRecord(worktree) &&
        (recordValue(worktree, "path") === targetPath ||
          recordValue(worktree, "worktree_path") === targetPath) &&
        typeof recordValue(worktree, "branch") === "string" &&
        (recordValue(worktree, "repository_path") === undefined ||
          recordValue(worktree, "repository_path") === repositoryPath) &&
        (recordValue(worktree, "open_workspace_id") === undefined ||
          typeof recordValue(worktree, "open_workspace_id") === "string"),
    )
  );
};

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

const hasUnknownSession = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
): boolean => {
  const agent = findSession(source, input, sessionName);
  return agent !== undefined && recordValue(agent, "agent_status") === "unknown";
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
        (isActiveAgentStatus(recordValue(agent, "agent_status")) ||
          recordValue(agent, "agent_status") === "unknown"),
    )
  );
};

const hasNamedAgentConflict = (source: string, sessionName: string, paneId: string): boolean => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return (
    Array.isArray(agents) &&
    agents.some(
      (agent) =>
        isRecord(agent) &&
        (recordValue(agent, "name") === sessionName ||
          recordValue(agent, "agent") === sessionName) &&
        recordValue(agent, "pane_id") !== undefined &&
        recordValue(agent, "pane_id") !== paneId,
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
    (paneId === undefined ? true : reportedPaneId === paneId) &&
    (!requireActive || isActiveAgentStatus(status))
  );
};

const isActiveAgentStatus = (status: unknown): boolean =>
  status === "idle" || status === "working" || status === "blocked";

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
