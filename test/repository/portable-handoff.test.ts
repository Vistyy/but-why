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

const runHandoff = (
  changeId: string,
): { readonly result: HandoffResult; readonly calls: string } => {
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
if [ "$1" = "by" ] && [ "$2" = "--json" ] && [ "$3" = "change" ] && [ "$4" = "implement" ]; then
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
  printf '%s\\n' '{"result":{"snapshot":{"agents":[],"panes":[],"workspaces":[]}}}'
  exit 0
fi
exit 1
`,
  );
  chmodSync(just, 0o755);
  chmodSync(herdr, 0o755);

  const result = runTestProcess(
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
      env: {
        // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index signature.
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        HANDOFF_CALLS: callsPath,
        HANDOFF_IMPLEMENT: JSON.stringify({
          changeId,
          worktreePath,
          host: "herdr",
          status: "started",
        }),
        HANDOFF_SHOW: JSON.stringify({
          change: { id: changeId, state: "open", readiness: "ready", worktreePath },
          worktreePath,
        }),
        HANDOFF_OBSERVER_POLL_MS: "5",
        HANDOFF_OBSERVER_SLOW_MS: "10000",
      },
      isolatedHome: createTestWorkspace(),
      input: "Implement the authorized work.\n",
      timeout: 10_000,
    },
  );

  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return {
    result: JSON.parse(result.stdout) as HandoffResult,
    calls: readFileSync(callsPath, "utf8"),
  };
};

describe("portable handoff observer", () => {
  it.each([
    ["Task-backed Change", "change-task-backed"],
    ["taskless Change", "change-taskless"],
  ])("verifies the exact Change and Managed Worktree for a %s", (_kind, changeId) => {
    const handoff = runHandoff(changeId);

    expect(handoff.result).toMatchObject({ changeId, status: "started", changeVerified: true });
    expect(handoff.calls).toContain(`by --json change implement ${changeId}`);
    expect(handoff.calls).toContain(`by --json change show ${changeId}`);
  });
});
