import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcess } from "../support/testProcess.js";

type HandoffResult = {
  readonly changeId: string;
  readonly worktreePath: string;
  readonly status: string;
  readonly changeVerified: boolean;
};

type HandoffRoute = "task-backed" | "taskless-existing" | "taskless-new";

type HandoffOptions = {
  readonly route: HandoffRoute;
  readonly implementation?: unknown;
  readonly activeAgentName?: string;
  readonly implementationDelay?: string;
};

type HandoffExecution = {
  readonly status: number | null;
  readonly result: HandoffResult;
  readonly calls: string;
};

const runHandoff = (changeId: string, options: HandoffOptions): HandoffExecution => {
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
printf '%s\\n' "$*" >> "$HANDOFF_CALLS"
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "task" ] && [ "$4" = "show" ]; then
  printf '%s\\n' '{"task":{"id":"BY-1","state":"todo"}}'
  exit 0
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "start" ]; then
  printf '%s\\n' "$HANDOFF_START"
  exit 0
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "implement" ]; then
  sleep "$HANDOFF_IMPLEMENT_DELAY"
  printf '%s\\n' "$HANDOFF_IMPLEMENT"
  exit 0
fi
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "show" ]; then
  printf '%s\\n' "$HANDOFF_SHOW"
  exit 0
fi
exit 2
`,
  );
  writeFileSync(
    herdr,
    `#!/usr/bin/env sh
if [ "$1" = "api" ] && [ "$2" = "snapshot" ]; then
  if [ -n "$HANDOFF_AGENT_SNAPSHOT" ]; then
    printf '%s\\n' "$HANDOFF_AGENT_SNAPSHOT"
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

  const prelaunch =
    options.route === "task-backed"
      ? [
          ["by", "--json", "task", "show", "BY-1"],
          ["by", "--json", "change", "start", "--task", "BY-1"],
        ]
      : options.route === "taskless-existing"
        ? [["by", "--json", "change", "show", changeId]]
        : [["by", "--json", "change", "start"]];
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
    HANDOFF_CALLS: callsPath,
    HANDOFF_START: JSON.stringify({ change: { id: changeId }, worktreePath }),
    HANDOFF_IMPLEMENT:
      options.implementation ??
      JSON.stringify({ changeId, worktreePath, host: "herdr", status: "started" }),
    HANDOFF_SHOW: JSON.stringify({
      change: { id: changeId, state: "open", readiness: "ready", worktreePath },
      worktreePath,
    }),
    HANDOFF_AGENT_SNAPSHOT: activeAgentSnapshot,
    HANDOFF_IMPLEMENT_DELAY: options.implementationDelay ?? "0",
    HANDOFF_OBSERVER_POLL_MS: "5",
    HANDOFF_OBSERVER_SLOW_MS: "10000",
    HANDOFF_OBSERVER_IMPLEMENT_TIMEOUT_MS: "50",
    HANDOFF_OBSERVER_LATE_GRACE_MS: "100",
  };
  for (const args of prelaunch) {
    const command = runTestProcess(just, args, {
      cwd: root,
      env: environment,
      isolatedHome: createTestWorkspace(),
    });
    expect(command.status, `${command.stdout}${command.stderr}`).toBe(0);
  }

  const launched = runTestProcess(
    process.execPath,
    [
      join(repoRoot, "docs/public/skills/but-why/scripts/launch-handoff.mjs"),
      "--runner",
      "just",
      "--change-id",
      changeId,
      "--worktree-path",
      worktreePath,
    ],
    {
      cwd: root,
      env: environment,
      isolatedHome: createTestWorkspace(),
      input: "Implement the authorized work.\n",
      timeout: 10_000,
    },
  );
  return {
    status: launched.status,
    result: JSON.parse(launched.stdout) as HandoffResult,
    calls: readFileSync(callsPath, "utf8"),
  };
};

describe("portable handoff observer", () => {
  it.each([
    ["Task-backed Change", "change-task-backed", "task-backed"],
    ["existing taskless Change", "change-taskless-existing", "taskless-existing"],
    ["new taskless Change", "change-taskless-new", "taskless-new"],
  ] as const)("launches and verifies the documented %s route", (_kind, changeId, route) => {
    const handoff = runHandoff(changeId, { route });

    expect(handoff.status).toBe(0);
    expect(handoff.result).toMatchObject({ changeId, status: "started", changeVerified: true });
    if (route === "task-backed") {
      expect(handoff.calls).toContain("by --json task show BY-1");
      expect(handoff.calls).toContain("by --json change start --task BY-1");
    }
    if (route === "taskless-existing") {
      expect(handoff.calls).toContain(`by --json change show ${changeId}`);
    }
    if (route === "taskless-new") {
      expect(handoff.calls).toContain("by --json change start");
    }
    expect(handoff.calls).toContain(`by --json change implement ${changeId}`);
    expect(handoff.calls).toContain(`by --json change show ${changeId}`);
  });

  it("rejects an unrelated active session after Change Implement times out", () => {
    const changeId = "change-timeout";
    const handoff = runHandoff(changeId, {
      route: "taskless-existing",
      activeAgentName: "but-why-unrelated-change",
      implementationDelay: "1",
    });

    expect(handoff.status).toBe(1);
    expect(handoff.result).toMatchObject({ status: "launch_indeterminate", changeVerified: false });
  });
});
