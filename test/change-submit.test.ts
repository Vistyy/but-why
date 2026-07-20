import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "./support/by-cli.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { publicTaskId } from "../src/task/taskId.js";
import { candidateSqliteInput, git } from "./support/candidateReadyRepo.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";

describe("by change submit", () => {
  it.effect("rejects an unknown Change before selecting a Candidate", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", "missing-change", "--output", "json"],
        now,
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "change_not_found",
          message: "Change was not found.",
        },
        help: ["Use a Change ID returned by `by change start --output json`."],
      });
    }),
  );

  it.effect("returns TOON by default", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);

      const result = yield* runByInProcessEffect(root, ["change", "submit", "missing-change"], now);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("error:\n  code: change_not_found");
      expect(result.stdout).toContain("help[1]:");
    }),
  );

  it.effect("keeps an unchanged taskless Change open with explicit cancellation guidance", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
      };

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id, "--output", "json"],
        now,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changeId: change.change.id,
        status: "nothing_to_submit",
        help: [`Run \`by change cancel ${change.change.id}\` to cancel this unchanged Change.`],
      });
    }),
  );

  it.effect("returns structured Findings from live taskless Candidate validation", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      writeFileSync(
        join(root, ".but-why/config.json"),
        `${JSON.stringify({
          taskPrefix: "BY",
          validation: { checks: [{ id: "quality", command: "false" }] },
        })}\n`,
      );
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(join(change.worktreePath, "changed.txt"), "changed\n");
      git(change.worktreePath, "add", "changed.txt");
      git(
        change.worktreePath,
        "-c",
        "user.name=But Why Test",
        "-c",
        "user.email=but-why@example.test",
        "commit",
        "-m",
        "Change code",
      );

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id, "--output", "json"],
        now,
      );
      const output = JSON.parse(result.stdout) as {
        readonly error: {
          readonly code: string;
          readonly changeId: string;
          readonly candidateId: string;
          readonly validationRunId: string;
          readonly findings: readonly { readonly phase: string; readonly producer: string }[];
        };
      };

      expect(result.status).toBe(1);
      expect(output.error.code).toBe("validation_findings");
      expect(output.error.changeId).toBe(change.change.id);
      expect(output.error.candidateId).toBeTruthy();
      expect(output.error.validationRunId).toBeTruthy();
      expect(output.error.findings).toMatchObject([{ phase: "checks", producer: "quality" }]);
    }),
  );

  it.effect("returns a Task-backed Change with Findings to implementing", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      writeFileSync(
        join(root, ".but-why/config.json"),
        `${JSON.stringify({
          taskPrefix: "BY",
          validation: { checks: [{ id: "quality", command: "false" }] },
        })}\n`,
      );
      writeFileSync(
        join(root, ".test-global-config.json"),
        `${JSON.stringify({
          defaultAgentProfile: "test",
          agentProfiles: { test: { agentRuntime: "pi", agentModel: "test/model" } },
        })}\n`,
      );
      const tasks = openSqliteTaskStore({ ...candidateSqliteInput(root, now), taskPrefix: "BY" });
      const task = tasks.createTask({ title: "Approved task", description: "Deliver it", now });
      const taskId = publicTaskId(task.id);
      const approved = tasks.approveTask({ taskId, now });
      expect(approved.ok).toBe(true);
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", taskId, "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(join(change.worktreePath, "changed.txt"), "changed\n");
      git(change.worktreePath, "add", "changed.txt");
      git(
        change.worktreePath,
        "-c",
        "user.name=But Why Test",
        "-c",
        "user.email=but-why@example.test",
        "commit",
        "-m",
        "Implement approved task",
      );

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id, "--output", "json"],
        now,
      );

      expect(result.status).toBe(1);
      expect(
        (JSON.parse(result.stdout) as { readonly error: { readonly code: string } }).error.code,
      ).toBe("validation_findings");
      expect(tasks.getTaskById(taskId)?.state).toBe("implementing");
    }),
  );

  it.effect("rejects dirty Git-visible state before selecting a Candidate", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        now,
      );
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };
      writeFileSync(join(change.worktreePath, "dirty.txt"), "dirty\n");

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id, "--output", "json"],
        now,
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "dirty_work",
          message: "The Change Managed Worktree has uncommitted Git-visible state.",
        },
        help: ["Commit or remove the visible changes, then retry Change Submit."],
      });
    }),
  );
});
