import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "./support/by-cli.js";
import type { ReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { publicTaskId } from "../src/task/taskId.js";
import { candidateSqliteInput, git } from "./support/candidateReadyRepo.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

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

  it.effect("validates and publishes a passing taskless Candidate", () =>
    withPublicationTools(() =>
      Effect.gen(function* () {
        const root = initializedSubmitRepository("true");
        const started = yield* runByInProcessEffect(
          root,
          ["change", "start", "--output", "json"],
          now,
        );
        const change = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };
        commitChangedWork(change.worktreePath, "Publish taskless work");
        git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");

        const result = yield* runByInProcessEffect(
          root,
          ["change", "submit", change.change.id, "--output", "json"],
          now,
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          changeId: change.change.id,
          status: "published",
          created: true,
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        });
      }),
    ),
  );

  it.effect("validates and publishes a passing Task-backed Candidate", () =>
    withPublicationTools(() =>
      Effect.gen(function* () {
        const root = initializedFullValidationSubmitRepository();
        writeFileSync(
          join(root, ".test-global-config.json"),
          `${JSON.stringify({
            defaultAgentProfile: "test",
            agentProfiles: { test: { agentRuntime: "pi", agentModel: "test/model" } },
          })}\n`,
        );
        const tasks = openSqliteTaskStore({ ...candidateSqliteInput(root), taskPrefix: "BY" });
        const task = tasks.createTask({ title: "Approved task", description: "Deliver it", now });
        const taskId = publicTaskId(task.id);
        expect(tasks.approveTask({ taskId, now }).ok).toBe(true);
        const started = yield* runByInProcessEffect(
          root,
          ["change", "start", "--task", taskId, "--output", "json"],
          now,
        );
        const change = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };
        commitChangedWork(change.worktreePath, "Publish approved work");
        git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");

        const result = yield* runByInProcessEffect(
          root,
          ["change", "submit", change.change.id, "--output", "json"],
          now,
          { reviewerAgentRuntime: passingReviewer },
        );

        expect(result.status).toBe(0);
        const submission = JSON.parse(result.stdout) as {
          readonly validationRunId: string;
        };
        expect(submission).toMatchObject({
          changeId: change.change.id,
          status: "published",
          created: true,
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        });

        const validationRun = yield* runByInProcessEffect(root, [
          "validation-run",
          "show",
          submission.validationRunId,
          "--output",
          "json",
        ]);
        expect(validationRun.status).toBe(0);
        expect(JSON.parse(validationRun.stdout)).toMatchObject({
          phases: [
            { phase: "prepare", rounds: [{ producer: "prepare", status: "passed" }] },
            { phase: "checks", rounds: [{ producer: "quality", status: "passed" }] },
            {
              phase: "acceptance_review",
              rounds: [{ producer: "acceptance", status: "passed" }],
            },
            {
              phase: "specialist_review",
              rounds: [{ producer: "standards", status: "passed" }],
            },
          ],
          findings: [],
        });

        const findings = yield* runByInProcessEffect(root, [
          "change",
          "findings",
          change.change.id,
          "--output",
          "json",
        ]);
        expect(findings.status).toBe(0);
        expect(JSON.parse(findings.stdout)).toMatchObject({
          validationRun: { id: submission.validationRunId, outcome: "passed" },
          findings: [],
          toolingFailures: [],
        });
        expect(tasks.getTaskById(taskId)?.state).toBe("ready");
      }),
    ),
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

      git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");
      const result = yield* withPublicationTools(() =>
        runByInProcessEffect(root, ["change", "submit", change.change.id, "--output", "json"], now),
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
      const tasks = openSqliteTaskStore({ ...candidateSqliteInput(root), taskPrefix: "BY" });
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

      git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");
      const result = yield* withPublicationTools(() =>
        runByInProcessEffect(root, ["change", "submit", change.change.id, "--output", "json"], now),
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

const passingReviewer: ReviewerAgentRuntime = {
  review: () =>
    Effect.succeed({
      ok: true,
      report: { findings: [] },
      attempts: 1,
      stdout: "",
    }),
};

const initializedSubmitRepository = (checkCommand: string): string => {
  const root = createInitializedRepo();
  writeFileSync(
    join(root, ".but-why/config.json"),
    `${JSON.stringify({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: checkCommand }] },
    })}\n`,
  );
  commitButWhyConfigAndRecordDefault(root);
  return root;
};

const initializedFullValidationSubmitRepository = (): string => {
  const root = createInitializedRepo();
  writeFileSync(
    join(root, ".but-why/config.json"),
    `${JSON.stringify({
      taskPrefix: "BY",
      prepare: { command: "true" },
      validation: { checks: [{ id: "quality", command: "true" }] },
      review: { specialists: ["standards"] },
      reviewers: {
        standards: {
          instructionsFile: ".but-why/reviewers/standards.md",
          agentProfile: "test",
        },
      },
    })}\n`,
  );
  mkdirSync(join(root, ".but-why/reviewers"), { recursive: true });
  writeFileSync(
    join(root, ".but-why/reviewers/standards.md"),
    "Review the Candidate for repository standards.\n",
  );
  commitButWhyConfigAndRecordDefault(root);
  return root;
};

const commitChangedWork = (worktreePath: string, subject: string): void => {
  writeFileSync(join(worktreePath, "changed.txt"), "changed\n");
  git(worktreePath, "add", "changed.txt");
  git(
    worktreePath,
    "-c",
    "user.name=But Why Test",
    "-c",
    "user.email=but-why@example.test",
    "commit",
    "-m",
    subject,
  );
};

const withPublicationTools = <Result, Error, Requirements>(
  work: () => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements> =>
  Effect.acquireUseRelease(Effect.sync(installPublicationTools), work, (restore) =>
    Effect.sync(restore),
  );

const installPublicationTools = (): (() => void) => {
  // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
  const originalPath = process.env["PATH"];
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = createTestWorkspace();
  writeExecutable(
    join(bin, "git"),
    `#!/usr/bin/env sh
set -eu
if [ "$1" = "ls-remote" ] && [ "$2" = "--heads" ]; then
  exit 0
fi
if [ "$1" = "push" ]; then
  exit 0
fi
exec "${realGit}" "$@"
`,
  );
  writeExecutable(
    join(bin, "gh"),
    `#!/usr/bin/env sh
set -eu
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"main"}}\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "--method" ] && [ "$3" = "POST" ]; then
  head_branch=""
  for argument in "$@"; do
    case "$argument" in
      head=*) head_branch="\${argument#head=}" ;;
    esac
  done
  head_sha=$("${realGit}" rev-parse "refs/heads/$head_branch")
  printf '{"number":42,"url":"https://github.test/acme/repo/pull/42","base":{"ref":"main"},"head":{"ref":"%s","sha":"%s"}}\\n' "$head_branch" "$head_sha"
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '[]\\n'
  exit 0
fi
exit 1
`,
  );
  // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
  process.env["PATH"] = originalPath === undefined ? bin : `${bin}:${originalPath}`;
  return () => {
    if (originalPath === undefined) {
      // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
      delete process.env["PATH"];
    } else {
      // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
      process.env["PATH"] = originalPath;
    }
  };
};

const writeExecutable = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
