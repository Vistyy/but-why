import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { InteractiveSessionHost } from "../src/change/interactiveSessionHost.js";
import {
  cleanupTempRoots,
  commitButWhyConfigAndRecordDefault,
  runByInProcessAsync,
} from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";

afterEach(cleanupTempRoots);

describe("by change implement", () => {
  it("launches a ready Change in its recorded Managed Worktree", async () => {
    const root = initializedRepository();
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly worktreePath: string;
    };
    const launches: unknown[] = [];
    const host: InteractiveSessionHost = {
      launch: async (input) => {
        launches.push(input);
        return { ok: true, host: "herdr", status: "started" };
      },
    };

    const result = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--output", "json"],
      now,
      { interactiveSessionHost: host },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      changeId: change.change.id,
      worktreePath: change.worktreePath,
      host: "herdr",
      status: "started",
    });
    expect(launches).toEqual([
      {
        changeId: change.change.id,
        repositoryPath: root,
        worktreePath: change.worktreePath,
        initialPrompt: undefined,
      },
    ]);
  });

  it("rejects a Change whose Repository Preparation has not succeeded", async () => {
    const root = initializedRepository("exit 7");
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const failure = JSON.parse(started.stdout) as { readonly error: { readonly changeId: string } };
    const host: InteractiveSessionHost = {
      launch: async () => {
        throw new Error("Change Implement must not launch an unready Change");
      },
    };

    const result = await runByInProcessAsync(
      root,
      ["change", "implement", failure.error.changeId, "--output", "json"],
      now,
      { interactiveSessionHost: host },
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "change_not_ready" } });
  });

  it.each([
    ["already active", { ok: true, host: "herdr", status: "already_active" }, 0, "already_active"],
    [
      "unavailable",
      { ok: false, code: "host_unavailable", message: "Herdr is stopped." },
      1,
      "host_unavailable",
    ],
    [
      "launch failure",
      { ok: false, code: "launch_failed", message: "Pane is unavailable." },
      1,
      "launch_failed",
    ],
  ] as const)("reports a %s Interactive Session Host result", async (_name, hostResult, status, code) => {
    const root = initializedRepository();
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
    const host: InteractiveSessionHost = { launch: async () => hostResult };

    const result = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--output", "json"],
      now,
      { interactiveSessionHost: host },
    );

    expect(result.status).toBe(status);
    expect(JSON.parse(result.stdout)).toMatchObject(
      status === 0 ? { status: "already_active" } : { error: { code } },
    );
  });

  it("rejects standard input as a handoff source", async () => {
    const root = initializedRepository();
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };

    const result = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--handoff-file", "-", "--output", "json"],
      now,
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "unsupported_stdin_handoff_file" },
    });
  });

  it("keeps a ready Change launchable after a retryable host failure", async () => {
    const root = initializedRepository();
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
    const unavailable: InteractiveSessionHost = {
      launch: async () => ({ ok: false, code: "host_unavailable", message: "Herdr is stopped." }),
    };
    const available: InteractiveSessionHost = {
      launch: async () => ({ ok: true, host: "herdr", status: "started" }),
    };

    const failed = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--output", "json"],
      now,
      { interactiveSessionHost: unavailable },
    );
    const retried = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--output", "json"],
      now,
      { interactiveSessionHost: available },
    );

    expect(failed.status).toBe(1);
    expect(retried.status).toBe(0);
    expect(JSON.parse(retried.stdout)).toMatchObject({ status: "started" });
  });

  it("passes a compact handoff file unchanged to the Interactive Session Host", async () => {
    const root = initializedRepository();
    const started = await runByInProcessAsync(root, ["change", "start", "--output", "json"], now);
    const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
    const handoff = "# Handoff\n\nKeep the next step small.\n";
    const handoffPath = join(root, "handoff.md");
    writeFileSync(handoffPath, handoff);
    const received: string[] = [];
    const host: InteractiveSessionHost = {
      launch: async (input) => {
        if (input.initialPrompt !== undefined) received.push(input.initialPrompt);
        return { ok: true, host: "herdr", status: "started" };
      },
    };

    const result = await runByInProcessAsync(
      root,
      ["change", "implement", change.change.id, "--handoff-file", handoffPath, "--output", "json"],
      now,
      { interactiveSessionHost: host },
    );

    expect(result.status).toBe(0);
    expect(received).toEqual([handoff]);
  });
});

const initializedRepository = (prepare?: string): string => {
  const root = createInitializedRepo();
  if (prepare !== undefined) {
    writeFileSync(
      join(root, ".but-why", "config.json"),
      `${JSON.stringify({ taskPrefix: "BY", prepare: { command: prepare } }, null, 2)}\n`,
    );
  }
  commitButWhyConfigAndRecordDefault(root);
  return root;
};
