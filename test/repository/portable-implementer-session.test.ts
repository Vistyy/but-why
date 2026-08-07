import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { publicTaskId, taskSlugForId } from "../../src/task/taskId.js";
import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

type ImplementerSessionResult = {
  readonly changeId: string;
  readonly worktreePath: string;
  readonly status: string;
  readonly changeVerified: boolean;
  readonly tracePath?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly preLaunch?: {
    readonly exitCode: number;
    readonly timedOut: boolean;
    readonly result: unknown;
  };
};

type ImplementerSessionRoute = "task-backed" | "taskless-existing";

type ImplementerSessionOptions = {
  readonly route: ImplementerSessionRoute;
  readonly implementation?: string;
  readonly activeAgentName?: string;
  readonly implementationDelay?: string;
  readonly initialChangeId?: string;
  readonly linkedChangeId?: string;
  readonly taskState?: string;
  readonly taskResult?: string;
  readonly taskExitCode?: string;
  readonly startResult?: string;
  readonly startExitCode?: string;
  readonly finalChangeId?: string;
  readonly finalWorktreeMismatch?: boolean;
  readonly initialChangeTaskId?: string | null;
  readonly initialCommandResult?: string;
  readonly initialCommandExitCode?: string;
  readonly implementerPrompt?: string;
};

type ImplementerSessionExecution = {
  readonly status: number | null;
  readonly result: ImplementerSessionResult;
  readonly calls: string;
};

// The portable session's supported default timeout is 60 seconds.
const implementerSessionProcessTimeoutMs = 90_000;

const runImplementerSession = (
  changeId: string,
  options: ImplementerSessionOptions,
): ImplementerSessionExecution => {
  const root = createTestWorkspace();
  const bin = join(root, "bin");
  const worktreePath = join(root, "managed-worktree");
  const callsPath = join(root, "calls.txt");
  mkdirSync(bin, { recursive: true });
  const just = join(bin, "just");
  const herdr = join(bin, "herdr");

  writeFileSync(
    just,
    `#!/usr/bin/env sh
set -eu
printf '%s\\n' "$*" >> "$IMPLEMENTER_SESSION_CALLS"
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "task" ] && [ "$4" = "show" ]; then
  printf '%s\\n' "$IMPLEMENTER_SESSION_TASK"
  exit "$IMPLEMENTER_SESSION_TASK_EXIT"
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "start" ]; then
  printf '%s\\n' "$IMPLEMENTER_SESSION_START"
  exit "$IMPLEMENTER_SESSION_START_EXIT"
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "implement" ]; then
  sleep "$IMPLEMENTER_SESSION_IMPLEMENT_DELAY"
  printf '%s\\n' "$IMPLEMENTER_SESSION_IMPLEMENT"
  exit 0
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "show" ]; then
  if [ ! -e "$IMPLEMENTER_SESSION_SHOW_COUNT" ]; then
    : > "$IMPLEMENTER_SESSION_SHOW_COUNT"
    printf '%s\\n' "$IMPLEMENTER_SESSION_INITIAL_SHOW"
    exit "$IMPLEMENTER_SESSION_INITIAL_SHOW_EXIT"
  else
    printf '%s\\n' "$IMPLEMENTER_SESSION_FINAL_SHOW"
  fi
  exit 0
fi
exit 2
`,
  );
  writeFileSync(
    herdr,
    `#!/usr/bin/env sh
if [ "$1" = "api" ] && [ "$2" = "snapshot" ]; then
  if [ -n "$IMPLEMENTER_SESSION_AGENT_SNAPSHOT" ]; then
    printf '%s\\n' "$IMPLEMENTER_SESSION_AGENT_SNAPSHOT"
  else
    printf '%s\\n' '{"result":{"snapshot":{"agents":[],"panes":[],"workspaces":[]}}}'
  fi
  exit 0
fi
exit 1
`,
  );
  chmodSync(just, 0o755);
  chmodSync(herdr, 0o755);

  const taskId = options.route === "task-backed" ? "BY-1" : null;
  const mismatchedWorktreePath = join(root, "mismatched-worktree");
  const showResult = (
    shownChangeId: string,
    shownWorktreePath: string,
    shownTaskId: string | null = taskId,
  ) =>
    JSON.stringify({
      change: {
        id: shownChangeId,
        taskId: shownTaskId,
        state: "open",
        worktreePath: shownWorktreePath,
      },
      worktreePath: shownWorktreePath,
    });
  const activeAgentSnapshot =
    options.activeAgentName === undefined
      ? ""
      : JSON.stringify({
          result: {
            snapshot: {
              agents: [
                {
                  name: options.activeAgentName,
                  cwd: worktreePath,
                  pane_id: "pane-1",
                  agent_status: "working",
                },
              ],
              panes: [{ pane_id: "pane-1", cwd: worktreePath }],
              workspaces: [
                { workspace_id: "workspace-1", worktree: { checkout_path: worktreePath } },
              ],
            },
          },
        });
  const environment = {
    // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index signature:
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    IMPLEMENTER_SESSION_CALLS: callsPath,
    IMPLEMENTER_SESSION_START:
      options.startResult ?? JSON.stringify({ change: { id: changeId }, worktreePath }),
    IMPLEMENTER_SESSION_START_EXIT: options.startExitCode ?? "0",
    IMPLEMENTER_SESSION_TASK:
      options.taskResult ??
      JSON.stringify({
        task: {
          id: "BY-1",
          state: options.taskState ?? "todo",
          change:
            options.linkedChangeId === undefined
              ? null
              : { id: options.linkedChangeId, activity: "implementing" },
        },
      }),
    IMPLEMENTER_SESSION_TASK_EXIT: options.taskExitCode ?? "0",
    IMPLEMENTER_SESSION_IMPLEMENT:
      options.implementation ??
      JSON.stringify({ changeId, worktreePath, host: "herdr", status: "started" }),
    IMPLEMENTER_SESSION_INITIAL_SHOW:
      options.initialCommandResult ??
      showResult(options.initialChangeId ?? changeId, worktreePath, options.initialChangeTaskId),
    IMPLEMENTER_SESSION_INITIAL_SHOW_EXIT: options.initialCommandExitCode ?? "0",
    IMPLEMENTER_SESSION_FINAL_SHOW: showResult(
      options.finalChangeId ?? changeId,
      options.finalWorktreeMismatch ? mismatchedWorktreePath : worktreePath,
    ),
    IMPLEMENTER_SESSION_SHOW_COUNT: join(root, "show-count"),
    IMPLEMENTER_SESSION_DIAGNOSTIC_DIRECTORY: root,
    IMPLEMENTER_SESSION_AGENT_SNAPSHOT: activeAgentSnapshot,
    IMPLEMENTER_SESSION_IMPLEMENT_DELAY: options.implementationDelay ?? "0",
    IMPLEMENTER_SESSION_OBSERVER_POLL_MS: "5",
    IMPLEMENTER_SESSION_OBSERVER_SLOW_MS: "10000",
    IMPLEMENTER_SESSION_OBSERVER_IMPLEMENT_TIMEOUT_MS: "50",
    IMPLEMENTER_SESSION_OBSERVER_LATE_GRACE_MS: "100",
  };
  const launched = runTestProcess(
    process.execPath,
    [
      join(repoRoot, "docs/public/skills/but-why/scripts/start-implementer-session.mjs"),
      "--runner",
      "just",
      ...(options.route === "task-backed" ? ["--task-id", "BY-1"] : ["--change-id", changeId]),
    ],
    {
      cwd: root,
      env: environment,
      isolatedHome: createTestWorkspace(),
      input: options.implementerPrompt ?? "Implement the authorized work.\n",
      timeout: implementerSessionProcessTimeoutMs,
    },
  );
  return {
    status: launched.status,
    result: JSON.parse(launched.stdout) as ImplementerSessionResult,
    calls: readFileSync(callsPath, "utf8"),
  };
};

describe("portable Implementer Session observer", () => {
  it.each([
    ["Task-backed Change", "change-task-backed", "task-backed"],
    ["existing taskless Change", "change-taskless-existing", "taskless-existing"],
  ] as const)("launches and verifies the documented %s route", (_kind, changeId, route) => {
    const implementerSession = runImplementerSession(changeId, { route });

    expect(implementerSession.status).toBe(0);
    expect(implementerSession.result).toMatchObject({
      changeId,
      status: "started",
      changeVerified: true,
    });
    if (route === "task-backed") {
      expect(implementerSession.calls).toContain("by --json task show BY-1");
      expect(implementerSession.calls).toContain("by --json change start --task BY-1");
    }
    if (route === "taskless-existing") {
      expect(implementerSession.calls).toContain(`by --json change show ${changeId}`);
    }
    expect(implementerSession.calls).toContain(`by --json change implement ${changeId}`);
    expect(implementerSession.calls).toContain("--implementer-prompt-file");
    expect(implementerSession.calls).toContain(`by --json change show ${changeId}`);
  });

  it("reuses the Change linked from a Task", () => {
    const changeId = "linked-change";
    const implementerSession = runImplementerSession(changeId, {
      route: "task-backed",
      linkedChangeId: changeId,
    });

    expect(implementerSession.status).toBe(0);
    expect(implementerSession.calls).toContain("by --json task show BY-1");
    expect(implementerSession.calls).toContain(`by --json change show ${changeId}`);
    expect(implementerSession.calls).not.toContain("by --json change start --task BY-1");
  });

  it("rejects an unapproved Task before Change Start", () => {
    const implementerSession = runImplementerSession("new-task-change", {
      route: "task-backed",
      taskState: "new",
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      error: { code: "task_not_approved" },
    });
    expect(implementerSession.calls).not.toContain("by --json change start --task BY-1");
  });

  it("reports Change Start failure before launch", () => {
    const implementerSession = runImplementerSession("failed-start", {
      route: "task-backed",
      startResult: JSON.stringify({ error: { code: "change_start_conflict" } }),
      startExitCode: "1",
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      error: { code: "change_start_conflict" },
    });
  });

  it.each([
    [
      "a failed Task Show",
      JSON.stringify({ error: { code: "task_not_found" } }),
      "1",
      "task_not_found",
    ],
    [
      "a mismatched Task identity",
      JSON.stringify({ task: { id: "BY-2", state: "todo", change: null } }),
      "0",
      "task_verification_failed",
    ],
  ])("rejects %s before Change Start or Implement", (_kind, taskResult, taskExitCode, errorCode) => {
    const implementerSession = runImplementerSession("unverified-task", {
      route: "task-backed",
      taskResult,
      taskExitCode,
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      changeVerified: false,
      error: { code: errorCode },
      preLaunch: { exitCode: Number(taskExitCode), timedOut: false },
    });
    expect(implementerSession.calls).not.toContain("by --json change start --task BY-1");
    expect(implementerSession.calls).not.toContain("by --json change implement unverified-task");
    if (implementerSession.result.tracePath === undefined)
      throw new Error("Expected a pre-launch trace path");
    expect(existsSync(implementerSession.result.tracePath)).toBe(true);
    rmSync(dirname(implementerSession.result.tracePath), { recursive: true, force: true });
  });

  it("rejects an invalid linked Change identity before Change Start or Implement", () => {
    const implementerSession = runImplementerSession("invalid-linked-change", {
      route: "task-backed",
      taskResult: JSON.stringify({ task: { id: "BY-1", state: "todo", change: {} } }),
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      changeVerified: false,
      error: { code: "task_verification_failed" },
      preLaunch: { exitCode: 0, timedOut: false },
    });
    expect(implementerSession.calls).not.toContain("by --json change start --task BY-1");
    expect(implementerSession.calls).not.toContain(
      "by --json change implement invalid-linked-change",
    );
  });

  it("rejects a linked Change with a mismatched Task identity before Implement", () => {
    const implementerSession = runImplementerSession("linked-change", {
      route: "task-backed",
      linkedChangeId: "linked-change",
      initialChangeTaskId: "BY-2",
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      changeVerified: false,
      error: { code: "change_verification_failed" },
      preLaunch: { exitCode: 0, timedOut: false },
    });
    expect(implementerSession.calls).not.toContain("by --json change start --task BY-1");
    expect(implementerSession.calls).not.toContain("by --json change implement linked-change");
  });

  it.each(["", " \n\t"])("launches with no Implementer Prompt for %j", (input) => {
    const changeId = "change-no-context";
    const implementerSession = runImplementerSession(changeId, {
      route: "taskless-existing",
      implementerPrompt: input,
    });

    expect(implementerSession.status).toBe(0);
    expect(implementerSession.result).toMatchObject({
      changeId,
      status: "started",
      changeVerified: true,
    });
    expect(implementerSession.calls).toContain(`by --json change implement ${changeId}`);
    expect(implementerSession.calls).not.toContain("--implementer-prompt-file");
  });

  it.each([
    ["a taskless Change session", "change-timeout", "taskless-existing", "change-change-t"],
    [
      "a Task-backed Change session",
      "change-task-timeout",
      "task-backed",
      taskSlugForId(publicTaskId("BY-1")),
    ],
  ] as const)("accepts late recovery from %s", (_kind, changeId, route, activeAgentName) => {
    const implementerSession = runImplementerSession(changeId, {
      route,
      activeAgentName,
      implementationDelay: "1",
    });

    expect(implementerSession.status).toBe(0);
    expect(implementerSession.result).toMatchObject({
      status: "late_active",
      changeVerified: true,
    });
  });

  it("preserves a pre-launch Change Show failure", () => {
    const commandResult = {
      error: { code: "change_not_found", message: "Change was not found." },
    };
    const implementerSession = runImplementerSession("missing-change", {
      route: "taskless-existing",
      initialCommandResult: JSON.stringify(commandResult),
      initialCommandExitCode: "1",
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "prelaunch_verification_failed",
      changeVerified: false,
      error: commandResult.error,
      preLaunch: { exitCode: 1, timedOut: false, result: commandResult },
    });
    if (implementerSession.result.tracePath === undefined)
      throw new Error("Expected a pre-launch trace path");
    expect(existsSync(implementerSession.result.tracePath)).toBe(true);
    rmSync(dirname(implementerSession.result.tracePath), { recursive: true, force: true });
  });

  it.each([
    ["Task-backed", "initial", "Change ID", { initialChangeId: "other-change" }],
    ["Task-backed", "final", "Change ID", { finalChangeId: "other-change" }],
    ["Task-backed", "final", "Managed Worktree", { finalWorktreeMismatch: true }],
    ["taskless", "initial", "Change ID", { initialChangeId: "other-change" }],
    ["taskless", "final", "Change ID", { finalChangeId: "other-change" }],
    ["taskless", "final", "Managed Worktree", { finalWorktreeMismatch: true }],
  ] as const)("rejects a mismatched %s %s %s", (_routeName, _phase, _identity, mismatch) => {
    const route = _routeName === "Task-backed" ? "task-backed" : "taskless-existing";
    const implementerSession = runImplementerSession("change-identity", { route, ...mismatch });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result.changeVerified).toBe(false);
  });

  it("rejects an unrelated active session after Change Implement times out", () => {
    const changeId = "change-timeout";
    const implementerSession = runImplementerSession(changeId, {
      route: "taskless-existing",
      activeAgentName: "but-why-unrelated-change",
      implementationDelay: "1",
    });

    expect(implementerSession.status).toBe(1);
    expect(implementerSession.result).toMatchObject({
      status: "launch_indeterminate",
      changeVerified: false,
    });
  });
});
