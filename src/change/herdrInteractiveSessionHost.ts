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
      message: `Herdr must be installed and running before launching ${sessionName}: ${agents.message}`,
    };
  }
  if (activeAgentNames(agents.stdout).includes(sessionName)) {
    return { ok: true, host: "herdr", status: "already_active" };
  }

  const workspace = await execute([
    "workspace",
    "create",
    "--cwd",
    input.worktreePath,
    "--label",
    sessionName,
    "--no-focus",
  ]);
  if (!workspace.ok) return launchFailure(workspace.message);
  const workspaceId = workspaceIdentifier(workspace.stdout);
  if (workspaceId === undefined) {
    return launchFailure("Herdr did not return a workspace ID.");
  }

  const launched = await execute([
    "agent",
    "start",
    sessionName,
    "--workspace",
    workspaceId,
    "--no-focus",
    ...(path === undefined ? [] : ["--env", `PATH=${path}`]),
    "--",
    "pi",
    "--name",
    sessionName,
    piPrompt(input),
  ]);
  if (launched.ok) return { ok: true, host: "herdr", status: "started" };
  if (launched.message.includes("agent_name_taken")) {
    const retriedAgents = await execute(["agent", "list"]);
    if (retriedAgents.ok && activeAgentNames(retriedAgents.stdout).includes(sessionName)) {
      return { ok: true, host: "herdr", status: "already_active" };
    }
  }
  return launchFailure(launched.message);
};

const launchFailure = (message: string): InteractiveSessionLaunchResult => ({
  ok: false,
  code: "launch_failed",
  message: `Herdr could not launch the Interactive Session. ${message}`,
});

const piPrompt = (input: InteractiveSessionLaunchInput): string =>
  [
    `Implement Change ${input.changeId} in this Managed Worktree.`,
    ...(input.initialPrompt === undefined ? [] : [input.initialPrompt]),
  ].join("\n\n");

const activeAgentNames = (source: string): readonly string[] => {
  const result = herdrResult(source);
  const agents = result === undefined ? undefined : recordValue(result, "agents");
  return Array.isArray(agents) ? agentNames(agents) : [];
};

const agentNames = (agents: readonly unknown[]): readonly string[] =>
  agents.flatMap((agent) => {
    const name = isRecord(agent) ? recordValue(agent, "name") : undefined;
    return typeof name === "string" ? [name] : [];
  });

const workspaceIdentifier = (source: string): string | undefined => {
  const result = herdrResult(source);
  const workspace = result === undefined ? undefined : recordValue(result, "workspace");
  const workspaceId = isRecord(workspace) ? recordValue(workspace, "workspace_id") : undefined;
  return typeof workspaceId === "string" ? workspaceId : undefined;
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
