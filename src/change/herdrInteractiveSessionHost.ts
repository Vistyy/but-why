import { statSync } from "node:fs";

import { executeHostCommand } from "../command/hostCommand.js";

import { prependAgentEnvironment, shellQuote } from "../agent/agentEnvironment.js";
import { piResourceFlags } from "../agent/piRuntime.js";
import { resolvePackageAsset } from "./packageAssetPath.js";
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
  readinessTimeoutMs: 10_000,
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

export const trustedContinuationExtensionPath = (): string =>
  resolvePackageAsset("extensions/continue-change.ts");

const trustedImplementationAdvisorExtensionPath = (): string =>
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../extensions/implementation-advisor/index.ts",
  );

const launchHerdrSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  environment: HerdrInteractiveSessionHostOptions,
  signal: AbortSignal | undefined,
): Promise<InteractiveSessionLaunchResult> => {
  const options = { ...defaultOptions, ...environment };
  const continuationExtension = trustedContinuationExtensionPath();
  const advisorExtension = trustedImplementationAdvisorExtensionPath();
  let implementationAdvisor = input.implementationAdvisor;
  try {
    if (!statSync(continuationExtension).isFile()) {
      return launchFailure(
        `Required trusted continuation extension is not a file: ${continuationExtension}`,
      );
    }
  } catch {
    return launchFailure(
      `Required trusted continuation extension is missing: ${continuationExtension}`,
    );
  }
  const command = boundedExecutor(execute, options.commandTimeoutMs);
  if (implementationAdvisor !== undefined) {
    try {
      if (!statSync(advisorExtension).isFile()) implementationAdvisor = undefined;
    } catch {
      implementationAdvisor = undefined;
    }
  }
  const sessionName = input.herdrName ?? herdrSessionName(input.changeId);
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
    if (state.ok && worktreeMatchesTarget(state.stdout, input.worktreePath)) {
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
    const state = await observe(
      command,
      ["worktree", "list", "--cwd", input.worktreePath, "--json"],
      signal,
      options.observationRetries,
    );
    return state.ok && worktreeMatchesTarget(state.stdout, input.worktreePath)
      ? launchIndeterminate(
          "Herdr opened the Managed Worktree but returned incomplete workspace facts.",
        )
      : launchIndeterminate("Herdr returned malformed worktree-open output.");
  }
  const currentAgents = await observe(
    command,
    ["agent", "list"],
    signal,
    options.observationRetries,
  );
  if (!currentAgents.ok || !isValidAgentList(currentAgents.stdout)) {
    return launchIndeterminate(
      "Herdr did not provide a trustworthy pre-launch session observation.",
    );
  }
  if (hasActiveSession(currentAgents.stdout, input, sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }
  if (hasUnknownSession(currentAgents.stdout, input, sessionName)) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }
  return launchInOpenedWorktree(
    command,
    input,
    environment.path,
    sessionName,
    currentAgents.stdout,
    opened,
    signal,
    options,
    continuationExtension,
    implementationAdvisor,
    advisorExtension,
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
  continuationExtension: string,
  implementationAdvisor: InteractiveSessionLaunchInput["implementationAdvisor"],
  advisorExtension: string,
): Promise<InteractiveSessionLaunchResult> => {
  if (
    hasUnknownSession(listedAgents, input, sessionName) ||
    hasUnknownAgentInWorktree(listedAgents, input)
  ) {
    return launchIndeterminate("Herdr could not determine the existing session state.");
  }
  if (hasActiveAgentInWorktree(listedAgents, input)) {
    return launchFailure("Another Interactive Session is already active in this worktree.");
  }

  const launched = await execute(
    [
      "pane",
      "run",
      opened.rootPaneId,
      piCommand(input, path, continuationExtension, implementationAdvisor, advisorExtension),
    ],
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
      ? launchIndeterminate(observed.message, evidence)
      : observed.kind === "exited" || (observed.kind === "absent" && hasExitEvidence(evidence))
        ? launchFailure(
            observed.kind === "exited"
              ? `Pi exited during startup: ${observed.message}`
              : "Pi exited during startup.",
            evidence,
          )
        : isUncertainMutationFailure(launched.message)
          ? launchIndeterminate(
              `Herdr did not confirm whether Pi started: ${launched.message}`,
              evidence,
            )
          : launchFailure(launched.message, evidence);
  }

  const failedRename = async (message: string): Promise<InteractiveSessionLaunchResult> => {
    await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"], signal);
    if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId, signal);
    const evidence = await launchEvidence(execute, opened.rootPaneId, signal);
    return hasExitEvidence(evidence)
      ? launchFailure("Pi exited during startup.", evidence)
      : launchFailure(message, evidence);
  };
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
      return failedRename("Herdr did not provide a safe rename reconciliation.");
    }
    if (renamedSessionInList(renamedState.stdout, input, sessionName, opened.rootPaneId)) {
      // The mutation succeeded even though its response was lost.
    } else if (hasNamedAgentConflict(renamedState.stdout, sessionName, opened.rootPaneId)) {
      return failedRename("Herdr reported a naming conflict for the Interactive Session.");
    } else if (!renamed.ok && isUncertainMutationFailure(renamed.message)) {
      const retried = await execute(["agent", "rename", opened.rootPaneId, sessionName], signal);
      if (!retried.ok || !renamedSession(retried.stdout, input, sessionName, opened.rootPaneId)) {
        return failedRename(
          "Herdr did not confirm the named Pi session after retrying the rename.",
        );
      }
    } else {
      return failedRename(
        renamed.ok
          ? "Herdr did not confirm the named Pi session in the worktree root pane."
          : renamed.message,
      );
    }
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
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.max(1, remaining / (options.observationRetries + 1));
    const listed = await observe(
      boundedExecutor(execute, attemptTimeout),
      ["agent", "list"],
      signal,
      options.observationRetries,
    );
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
  /timed out|temporar|try again|connection reset|ECONNRESET|busy/i.test(message);

const isUncertainMutationFailure = (message: string): boolean =>
  /timed out|connection reset|ECONNRESET|response.*lost|lost response|no response|transport|connection.*closed|disconnected|broken pipe|eof/i.test(
    message,
  );

const isValidAgentList = (source: string): boolean => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return (
    result !== undefined &&
    recordValue(result, "type") === "agent_list" &&
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

const worktreeMatchesTarget = (source: string, targetPath: string): boolean => {
  const response = parseJson(source);
  const result = isRecord(response) ? recordValue(response, "result") : undefined;
  const worktrees = isRecord(result) ? recordValue(result, "worktrees") : undefined;
  return (
    isRecord(result) &&
    recordValue(result, "type") === "worktree_list" &&
    Array.isArray(worktrees) &&
    worktrees.some(
      (worktree) =>
        isRecord(worktree) &&
        (recordValue(worktree, "path") === targetPath ||
          recordValue(worktree, "worktree_path") === targetPath) &&
        typeof recordValue(worktree, "branch") === "string" &&
        (recordValue(worktree, "branch") as string).trim() !== "" &&
        (recordValue(worktree, "open_workspace_id") === undefined ||
          typeof recordValue(worktree, "open_workspace_id") === "string"),
    )
  );
};

const hasExitEvidence = (evidence: InteractiveSessionLaunchEvidence | undefined): boolean =>
  evidence?.exitEvidence !== undefined &&
  /exit|exited|terminated|code|pane[_ ]?not[_ ]?found|not[_ ]?found.*pane/i.test(
    evidence.exitEvidence,
  );

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
  const startupOutput = output.ok
    ? output.stdout.trim() || undefined
    : `Herdr pane read failed: ${output.message}`;
  const exitEvidence = processInfo.ok
    ? processInfo.stdout.trim() || undefined
    : `Herdr process inspection failed: ${processInfo.message}`;
  return startupOutput === undefined && exitEvidence === undefined
    ? undefined
    : {
        ...(startupOutput === undefined ? {} : { startupOutput }),
        ...(exitEvidence === undefined ? {} : { exitEvidence }),
      };
};

const piCommand = (
  input: InteractiveSessionLaunchInput,
  path: string | undefined,
  continuationExtension: string,
  implementationAdvisor: InteractiveSessionLaunchInput["implementationAdvisor"],
  advisorExtension: string,
): string => {
  const profileFlags = piResourceFlags(
    input.agentProfile?.profile.runtimeConfig,
    {
      scope: input.agentProfile?.scope ?? "repo",
      repoRoot: input.worktreePath,
      globalConfigDirectory: input.globalConfigDirectory,
    },
    {
      trustedExtensions: [
        continuationExtension,
        ...(implementationAdvisor === undefined ? [] : [advisorExtension]),
      ],
    },
  );
  const model = input.agentProfile?.profile.runtimeConfig?.model;
  const thinking = input.agentProfile?.profile.runtimeConfig?.thinking;
  const advisorEnvironment =
    implementationAdvisor === undefined
      ? []
      : [
          `BUT_WHY_IMPLEMENTATION_ADVISOR_MODEL=${shellQuote(implementationAdvisor.model)}`,
          ...(implementationAdvisor.thinking === undefined
            ? []
            : [
                `BUT_WHY_IMPLEMENTATION_ADVISOR_THINKING=${shellQuote(implementationAdvisor.thinking)}`,
              ]),
          ...(input.implementationAdvisorContext === undefined
            ? []
            : [
                `BUT_WHY_IMPLEMENTATION_ADVISOR_CONTEXT=${shellQuote(input.implementationAdvisorContext)}`,
              ]),
        ];
  return [
    ...(path === undefined ? [] : [`PATH=${shellQuote(path)}`]),
    ...advisorEnvironment,
    `exec ${prependAgentEnvironment("pi", input.agentEnvironment)}`,
    ...(input.systemPrompt === undefined
      ? []
      : ["--system-prompt", shellQuote(input.systemPrompt)]),
    "--name",
    shellQuote(input.piSessionName ?? input.herdrName ?? herdrSessionName(input.changeId)),
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

const hasUnknownAgentInWorktree = (
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
        recordValue(agent, "agent_status") === "unknown",
    )
  );
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

const renamedSessionInList = (
  source: string,
  input: InteractiveSessionLaunchInput,
  sessionName: string,
  rootPaneId: string,
): boolean => findSession(source, input, sessionName, rootPaneId) !== undefined;

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
  if (result === undefined || recordValue(result, "type") !== "worktree_opened") return undefined;
  const workspace = recordValue(result, "workspace");
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
