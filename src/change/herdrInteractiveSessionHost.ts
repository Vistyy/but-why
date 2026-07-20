import { spawn } from "node:child_process";

import type {
  InteractiveSessionHost,
  InteractiveSessionLaunchInput,
  InteractiveSessionLaunchResult,
} from "./interactiveSessionHost.js";

export type HerdrCommandExecutor = (
  args: readonly string[],
) => Promise<
  { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly message: string }
>;

export const openHerdrInteractiveSessionHost = (
  execute: HerdrCommandExecutor = executeHerdr,
  environment: { readonly path?: string } = {},
): InteractiveSessionHost => ({
  launch: async (input) => launchHerdrSession(execute, input, environment.path),
});

export const herdrSessionName = (changeId: string): string => `but-why-${changeId}`;

const launchHerdrSession = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  path: string | undefined,
): Promise<InteractiveSessionLaunchResult> => {
  const sessionName = herdrSessionName(input.changeId);
  const agents = await execute(["agent", "list"]);
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

  const worktree = await execute([
    "worktree",
    "open",
    "--cwd",
    input.repositoryPath,
    "--path",
    input.worktreePath,
    "--label",
    sessionName,
    "--no-focus",
  ]);
  if (!worktree.ok) return launchFailure(worktree.message);
  const opened = openedWorktree(worktree.stdout);
  if (opened === undefined) {
    return launchFailure("Herdr did not return a worktree root pane.");
  }
  return launchInOpenedWorktree(execute, input, path, sessionName, agents.stdout, opened);
};

const launchInOpenedWorktree = async (
  execute: HerdrCommandExecutor,
  input: InteractiveSessionLaunchInput,
  path: string | undefined,
  sessionName: string,
  listedAgents: string,
  opened: OpenedWorktree,
): Promise<InteractiveSessionLaunchResult> => {
  if (opened.alreadyOpen && hasActiveAgentInWorktree(listedAgents, input)) {
    return launchFailure("Another Interactive Session is already active in this worktree.");
  }

  const launched = await execute(["pane", "run", opened.rootPaneId, piCommand(input, path)]);
  if (!launched.ok) {
    if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId);
    return launchFailure(launched.message);
  }

  const renamed = await execute(["agent", "rename", opened.rootPaneId, sessionName]);
  if (renamed.ok && renamedSession(renamed.stdout, input, sessionName, opened.rootPaneId)) {
    return { ok: true, host: "herdr", status: "started" };
  }

  await execute(["pane", "send-keys", opened.rootPaneId, "ctrl-c"]);
  if (!opened.alreadyOpen) await closeWorkspace(execute, opened.workspaceId);
  return launchFailure(
    renamed.ok
      ? "Herdr did not confirm the named Pi session in the worktree root pane."
      : renamed.message,
  );
};

const launchFailure = (message: string): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_failed",
  message: `Herdr could not launch the Interactive Session: ${message}`,
});

const piCommand = (input: InteractiveSessionLaunchInput, path: string | undefined): string =>
  [
    ...(path === undefined ? [] : [`PATH=${shellQuote(path)}`]),
    "exec pi",
    "--name",
    shellQuote(herdrSessionName(input.changeId)),
    shellQuote(
      [
        `Implement Change ${input.changeId} in this Managed Worktree.`,
        ...(input.initialPrompt === undefined ? [] : [input.initialPrompt]),
      ].join("\n\n"),
    ),
  ].join(" ");

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
): Promise<void> => {
  await execute(["workspace", "close", workspaceId]);
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

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

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

const executeHerdr: HerdrCommandExecutor = (args) =>
  new Promise((resolve) => {
    const child = spawn("herdr", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
    child.once("close", (code) => {
      resolve(
        code === 0
          ? { ok: true, stdout }
          : { ok: false, message: stderr.trim() || `Herdr exited with status ${code ?? 1}.` },
      );
    });
  });
