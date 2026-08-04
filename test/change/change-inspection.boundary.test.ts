import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const firstNow = "2026-07-18T10:00:00.000Z";
const secondNow = "2026-07-18T10:05:00.000Z";
const commandNow = "2026-07-18T11:00:00.000Z";
let initializedRepoTemplate: string;

beforeAll(() => {
  initializedRepoTemplate = acquireTestWorkspace();
  createInitializedRepo(initializedRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(initializedRepoTemplate);
});

const initializedRepoCopy = () => cloneInitializedTestRepository(initializedRepoTemplate);

describe("Change inspection CLI", () => {
  it.effect("reports unavailable shared state before Change Submit accesses a Change", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "submit",
        randomUUID(),
      ]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "state_store_unavailable" },
      });
    }),
  );

  it.effect("infers the Change from its Managed Worktree and rejects the main checkout", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
      const startedView = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };

      const inferred = yield* runByInProcessEffect(startedView.worktreePath, [
        "--json",
        "change",
        "show",
      ]);
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "conflict Change branch fixture",
            (sql) =>
              sql`UPDATE changes SET branch_ref = ${"refs/heads/not-the-current-branch"} WHERE id = ${startedView.change.id}`,
          );
        }),
      );
      const branchConflict = yield* runByInProcessEffect(startedView.worktreePath, [
        "--json",
        "change",
        "show",
      ]);
      const explicit = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "show",
        startedView.change.id,
      ]);

      expect(started.status).toBe(0);
      expect(inferred.status).toBe(0);
      expect(JSON.parse(inferred.stdout).change.id).toBe(startedView.change.id);
      expect(branchConflict.status).toBe(1);
      expect(JSON.parse(branchConflict.stdout)).toMatchObject({
        error: { code: "change_context_unresolved", repositoryBranch: expect.any(String) },
        help: [expect.stringContaining("<change-id>")],
      });
      expect(explicit.status).toBe(0);
      expect(JSON.parse(explicit.stdout).change.id).toBe(startedView.change.id);
    }),
  );

  it.effect("lists open Changes by age, filters closed Changes, and shows taskless facts", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      const older = yield* createChangeFixture(root, "refs/heads/older", firstNow);
      const newer = yield* createChangeFixture(root, "refs/heads/newer", secondNow);
      yield* closeChangeFixture(root, newer.id, "cancelled", secondNow);

      const defaultResult = yield* runByInProcessEffect(
        root,
        ["--json", "change", "list"],
        commandNow,
      );
      const allResult = yield* runByInProcessEffect(
        root,
        ["--json", "change", "list", "--all"],
        commandNow,
      );
      const openShown = yield* runByInProcessEffect(root, ["--json", "change", "show", older.id]);
      const closedShown = yield* runByInProcessEffect(root, ["--json", "change", "show", newer.id]);

      expect(JSON.parse(defaultResult.stdout)).toEqual({
        changes: [
          {
            id: older.id,
            taskId: null,
            state: "open",
            createdAt: firstNow,
            ageSeconds: 3_600,
          },
        ],
      });
      expect(
        JSON.parse(allResult.stdout).changes.map((change: { readonly id: string }) => change.id),
      ).toEqual([older.id, newer.id]);
      expect(JSON.parse(openShown.stdout)).toEqual({
        change: {
          id: older.id,
          taskId: null,
          state: "open",
          closeReason: null,
          branchRef: "refs/heads/older",
          baseRef: null,
          worktreePath: null,
          startingCommit: null,
          createdAt: firstNow,
          closedAt: null,
        },
        currentCandidate: null,
        currentValidationRun: null,
        findingCount: 0,
        toolingFailureCount: 0,
        publicationsCommand: `by change publications ${older.id}`,
        pullRequest: null,
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(JSON.parse(closedShown.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "cancelled" },
        cleanup: { state: "pending", blockingReason: null },
      });
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "install CLI publication fixture",
            (sql) => sql`
            INSERT INTO candidate_publications
              (change_id, candidate_id, validation_run_id, change_base_sha, head_sha,
               publication_owner, publication_repo, publication_base_branch, publication_remote_name,
               publication_head_branch, pull_request_number, pull_request_url, published_at)
            VALUES (${older.id}, 'candidate-cli', 'run-cli', 'base-cli', 'head-cli',
              'acme', 'repo', 'main', 'origin', 'older', 42,
              'https://github.test/pull/42', ${commandNow})
          `,
          );
        }),
      );
      const nonEmptyJson = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "publications",
        older.id,
      ]);
      expect(nonEmptyJson.status).toBe(0);
      expect(JSON.parse(nonEmptyJson.stdout)).toMatchObject({
        changeId: older.id,
        count: 1,
        publications: [{ headSha: "head-cli" }],
      });
      const nonEmptyToon = yield* runByInProcessEffect(root, ["change", "publications", older.id]);
      expect(nonEmptyToon.status).toBe(0);
      expect(nonEmptyToon.stdout).toContain("head-cli");
      const emptyJson = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "publications",
        newer.id,
      ]);
      expect(emptyJson.status).toBe(0);
      expect(JSON.parse(emptyJson.stdout)).toMatchObject({
        changeId: newer.id,
        count: 0,
        publications: [],
      });
      const emptyToon = yield* runByInProcessEffect(root, ["change", "publications", newer.id]);
      expect(emptyToon.status).toBe(0);
      expect(emptyToon.stdout).toContain("count: 0");
      expect(emptyToon.stdout).toContain("No Candidate Publications recorded.");
      const missing = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "publications",
        randomUUID(),
      ]);
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout)).toMatchObject({ error: { code: "change_not_found" } });
      const missingToon = yield* runByInProcessEffect(root, [
        "change",
        "publications",
        randomUUID(),
      ]);
      expect(missingToon.status).toBe(1);
      expect(missingToon.stdout).toContain("change_not_found");
    }),
  );

  it.effect("inspects current Findings and orders Validation Run History across Candidates", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      const change = yield* createChangeFixture(root, "refs/heads/history", firstNow);
      const firstCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "refs/heads/history",
        "first-head",
        firstNow,
      );
      const secondCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "refs/heads/history",
        "second-head",
        secondNow,
      );
      const olderCandidateRun = yield* withValidationPersistence(root, (persistence) =>
        persistence.startOrReuse({
          candidateId: firstCandidate.id,
          headSha: firstCandidate.headSha,
          policy: { checks: [], copyFiles: [] },
          now: commandNow,
        }),
      );
      if (olderCandidateRun.reused) throw new Error("Expected new Validation Run");
      yield* withValidationPersistence(root, (persistence) =>
        persistence.complete({
          validationRunId: olderCandidateRun.validationRunId,
          outcome: "passed",
          now: commandNow,
        }),
      );
      const newerRun = yield* withValidationPersistence(root, (persistence) =>
        persistence.startOrReuse({
          candidateId: secondCandidate.id,
          headSha: secondCandidate.headSha,
          policy: { checks: [], copyFiles: [] },
          now: secondNow,
        }),
      );
      if (newerRun.reused) throw new Error("Expected new Validation Run");
      yield* withValidationPersistence(root, (persistence) =>
        persistence.recordCheckRound({
          validationRunId: newerRun.validationRunId,
          producer: "types",
          roundNumber: 1,
          roundStatus: "failed",
          phaseStatus: "failed",
          artifactRecords: [],
          finding: {
            id: `${newerRun.validationRunId}-F1`,
            validationRunId: newerRun.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Check failed: types",
            description: "Type checking failed.",
            evidence: "exitCode: 1",
            files: ["src/main.ts"],
            artifactRefs: [],
          },
          now: commandNow,
        }),
      );
      yield* withValidationPersistence(root, (persistence) =>
        persistence.recordToolingFailure({
          validationRunId: newerRun.validationRunId,
          errorKind: "validation_workspace_setup_failed",
          operationName: "cleanup_validation_worktree",
          errorMessage: "Could not remove worktree.",
          now: commandNow,
        }),
      );
      const findings = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "findings",
        change.id,
      ]);
      const history = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "validation-runs",
        change.id,
      ]);
      const shown = yield* runByInProcessEffect(root, ["--json", "change", "show", change.id]);

      expect(JSON.parse(findings.stdout)).toMatchObject({
        change: { id: change.id },
        candidate: { id: secondCandidate.id },
        validationRun: { id: newerRun.validationRunId, state: "running", outcome: null },
        findings: [{ id: `${newerRun.validationRunId}-F1`, files: ["src/main.ts"] }],
        toolingFailures: [{ operationName: "cleanup_validation_worktree" }],
        count: 1,
      });
      expect(JSON.parse(history.stdout)).toMatchObject({
        count: 2,
        outcomeCounts: { passed: 1 },
        runningCount: 1,
        detailCommand: "by validation-run show <validation-run-id>",
        validationRuns: [
          {
            id: newerRun.validationRunId,
            candidateId: secondCandidate.id,
            state: "running",
            outcome: null,
            createdAt: secondNow,
            updatedAt: secondNow,
          },
          {
            id: olderCandidateRun.validationRunId,
            candidateId: firstCandidate.id,
            state: "complete",
            outcome: "passed",
            createdAt: commandNow,
            updatedAt: commandNow,
          },
        ],
      });
      expect(JSON.parse(shown.stdout)).toMatchObject({
        currentValidationRun: {
          id: newerRun.validationRunId,
          candidateId: secondCandidate.id,
          state: "running",
          outcome: null,
          createdAt: secondNow,
          updatedAt: secondNow,
        },
        findingCount: 1,
        toolingFailureCount: 1,
        findingsCommand: `by change findings ${change.id}`,
        validationRunCommand: `by validation-run show ${newerRun.validationRunId}`,
      });
      expect(JSON.parse(shown.stdout).currentValidationRun.policy).toBeUndefined();
    }),
  );

  it.effect("rejects a remote Task comment before requiring local state", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      writeFileSync(join(root, "comment.md"), "Valid comment");
      rmSync(join(root, ".git", "but-why", "state.sqlite"));

      const result = yield* runByInProcessEffect(root, [
        "task",
        "comment",
        "linear/ENG-123:acceptance",
        "--file",
        "comment.md",
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
    }),
  );

  it.effect("keeps an unchanged taskless Change open with explicit cancellation guidance", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], firstNow);
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "submit", change.change.id],
        firstNow,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changeId: change.change.id,
        status: "nothing_to_submit",
        help: [
          "Continue implementation in the Managed Worktree and retry Change Submit, or cancel explicitly.",
          `Run \`by change cancel ${change.change.id}\` to cancel this unchanged Change.`,
        ],
      });
    }),
  );

  it.effect("keeps non-review policy from Change Base while using Candidate reviewer config", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          { taskPrefix: "BY", validation: { checks: [{ id: "base", command: "false" }] } },
          null,
          2,
        )}\n`,
      );
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], firstNow);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };

      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          { taskPrefix: "BY", validation: { checks: [{ id: "caller", command: "true" }] } },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(change.worktreePath, ".but-why", "config.json"),
        `${JSON.stringify(
          { taskPrefix: "BY", validation: { checks: [{ id: "managed", command: "true" }] } },
          null,
          2,
        )}\n`,
      );
      runTestProcessOrThrow("git", ["config", "user.name", "But Why Test"], {
        cwd: change.worktreePath,
      });
      runTestProcessOrThrow("git", ["config", "user.email", "but-why@example.test"], {
        cwd: change.worktreePath,
      });
      runTestProcessOrThrow("git", ["add", ".but-why/config.json"], {
        cwd: change.worktreePath,
      });
      runTestProcessOrThrow("git", ["commit", "-m", "Use Managed Worktree validation policy"], {
        cwd: change.worktreePath,
      });

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "change", "submit", change.change.id],
        firstNow,
      );
      const output = JSON.parse(result.stdout) as {
        readonly error: {
          readonly code: string;
        };
      };

      expect(result.status).toBe(1);
      expect(output.error.code).toBe("validation_findings");
      expect(result.stdout).toContain("command: false");
      expect(result.stdout).not.toContain('"severity"');
    }),
  );

  it.effect("records and lists an ordered Implementation Decision Log through Change CLI", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      const change = yield* createChangeFixture(root, "refs/heads/decisions", firstNow);
      const added = yield* runByInProcessEffect(
        root,
        [
          "--json",
          "change",
          "decision",
          "add",
          change.id,
          "--choice",
          "Use an append-only record",
          "--rationale",
          "Keep material choices separate from rationale.",
        ],
        commandNow,
      );
      const listed = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "decision",
        "list",
        change.id,
      ]);
      const shown = yield* runByInProcessEffect(root, ["--json", "change", "show", change.id]);

      expect(added.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        changeId: change.id,
        count: 1,
        decisions: [
          {
            changeId: change.id,
            sequence: 1,
            choice: "Use an append-only record",
            rationale: "Keep material choices separate from rationale.",
          },
        ],
      });
      expect(JSON.parse(shown.stdout).implementationDecisions).toHaveLength(1);

      const missing = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "decision",
        "add",
        change.id,
      ]);
      const empty = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "decision",
        "add",
        change.id,
        "--choice",
        "",
        "--rationale",
        "A reason",
      ]);
      const emptyRationale = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "decision",
        "add",
        change.id,
        "--choice",
        "A choice",
        "--rationale",
        "",
      ]);
      const help = yield* runByInProcessEffect(root, ["change", "decision", "add", "--help"]);
      const blockerHelp = yield* runByInProcessEffect(root, [
        "change",
        "blocker",
        "raise",
        "--help",
      ]);
      const multiline = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "decision",
        "add",
        change.id,
        "--choice",
        "Two lines\nnot allowed",
        "--rationale",
        "A reason",
      ]);
      expect(missing.status).toBe(2);
      expect(JSON.parse(missing.stdout)).toMatchObject({
        error: { code: "invalid_usage" },
        help: expect.any(Array),
      });
      expect(empty.status).toBe(2);
      expect(JSON.parse(empty.stdout)).toMatchObject({
        error: {
          code: "empty_choice",
          message: "Implementation Decision Choice is required and must not be empty.",
        },
        help: ["Provide --choice <one-line approach> and --rationale <reason>."],
      });
      expect(emptyRationale.status).toBe(2);
      expect(JSON.parse(emptyRationale.stdout)).toMatchObject({
        error: {
          code: "empty_rationale",
          message: "Implementation Decision Rationale is required and must not be empty.",
        },
        help: ["Provide --choice <one-line approach> and --rationale <reason>."],
      });
      expect(multiline.status).toBe(2);
      expect(JSON.parse(multiline.stdout)).toMatchObject({
        error: {
          code: "multiline_choice",
          message: "Implementation Decision Choice must be one line.",
        },
        help: ["Provide --choice <one-line approach> and --rationale <reason>."],
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("The selected one-line material approach.");
      expect(help.stdout).toContain("Why the approach was selected and its material trade-off.");
      expect(blockerHelp.status).toBe(0);
      expect(blockerHelp.stdout).toContain("unresolved issue");
      expect(blockerHelp.stdout).toContain("continuing is unsafe");
      expect(blockerHelp.stdout).toContain("external decision or action");
    }),
  );

  it.effect(
    "submits a reviewer Finding through public Change Submit and both inspection views",
    () =>
      Effect.gen(function* () {
        const root = yield* initializedRepoCopy();
        writeFileSync(
          join(root, ".but-why", "config.json"),
          `${JSON.stringify({ taskPrefix: "BY", validation: { checks: [{ id: "quality", command: "true" }] } }, null, 2)}\n`,
        );
        commitButWhyConfigAndRecordDefault(root);
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const tasks = yield* openSqliteTaskPersistence("BY");
            const created = yield* tasks.createTask({
              title: "Public reviewer Finding",
              description: "Exercise the public reviewer submission seam.",
              now: firstNow,
            });
            if (!created.ok) throw new Error(created.code);
            const approved = yield* tasks.approveTask({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            if (!approved.ok) throw new Error(approved.code);
          }),
        );
        const started = yield* runByInProcessEffect(root, [
          "--json",
          "change",
          "start",
          "--task",
          "BY-1",
        ]);
        const startedView = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };
        const changeId = startedView.change.id;
        writeFileSync(join(startedView.worktreePath, "reviewed.txt"), "reviewed\n");
        runTestProcessOrThrow("git", ["add", "reviewed.txt"], { cwd: startedView.worktreePath });
        runTestProcessOrThrow("git", ["commit", "-m", "Add reviewed file"], {
          cwd: startedView.worktreePath,
        });
        writeFileSync(
          join(root, ".test-global-config.json"),
          `${JSON.stringify(
            {
              defaultAgentProfile: { scope: "global", name: "test" },
              agentProfiles: {
                test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
              },
            },
            null,
            2,
          )}\n`,
        );
        const reviewerAgentRuntime: ReviewerAgentRuntime = {
          review: () =>
            Effect.succeed({
              ok: true as const,
              report: {
                findings: [
                  {
                    title: "Public reviewer mismatch",
                    description: "The fake reviewer reports one material mismatch.",
                    evidence: "The composed public submission returned this Finding.",
                    files: ["reviewed.txt"],
                    artifactRefs: [],
                  },
                ],
              },
              attempts: 1,
              stdout: "fake reviewer output",
            }),
        };
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "change", "submit", changeId],
          commandNow,
          { reviewerAgentRuntime },
        );
        expect(submitted.status, submitted.stdout).toBe(1);
        const findings = yield* runByInProcessEffect(root, [
          "--json",
          "change",
          "findings",
          changeId,
        ]);
        const findingsView = JSON.parse(findings.stdout) as {
          readonly validationRun: { readonly id: string } | null;
        };
        expect(
          findingsView.validationRun,
          `${submitted.stdout}\n${findings.stdout}`,
        ).not.toBeNull();
        const validationRun = findingsView.validationRun?.id ?? "";
        const shown = yield* runByInProcessEffect(root, [
          "--json",
          "validation-run",
          "show",
          validationRun,
        ]);

        expect(submitted.status).toBe(1);
        expect(JSON.parse(findings.stdout).findings).toContainEqual(
          expect.objectContaining({ title: "Public reviewer mismatch", files: ["reviewed.txt"] }),
        );
        expect(findings.stdout).not.toContain('"severity"');
        expect(JSON.parse(shown.stdout).findings).toContainEqual(
          expect.objectContaining({
            evidence: "The composed public submission returned this Finding.",
          }),
        );
        expect(shown.stdout).not.toContain('"severity"');
      }),
  );

  it.effect("projects linked Change progress through Task inspection", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const tasks = yield* openSqliteTaskPersistence("BY");
          const created = yield* tasks.createTask({
            title: "Task-backed Change",
            description: "Inspect progress",
            now: firstNow,
          });
          if (!created.ok) throw new Error(created.code);
          const approved = yield* tasks.approveTask({
            taskId: publicTaskId("BY-1"),
            now: secondNow,
          });
          if (!approved.ok) throw new Error(approved.code);
        }),
      );

      const started = yield* runByInProcessEffect(root, [
        "--json",
        "change",
        "start",
        "--task",
        "BY-1",
      ]);
      const startedView = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly branch: string;
      };
      const changeId = startedView.change.id;
      const shown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);

      expect(started.status).toBe(0);
      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "Task-backed Change",
          state: "implementing",
          change: { id: changeId, activity: "implementing" },
        },
      });
      expect(JSON.parse(shown.stdout).task).not.toHaveProperty("startable");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("state");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("readiness");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("activeBlocker");
      const toonShown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
      expect(toonShown.stdout).toContain(`id: ${changeId}`);
      expect(toonShown.stdout).toContain("activity: implementing");
      expect(toonShown.stdout).not.toContain("startable");
      expect(toonShown.stdout).not.toContain("readiness");
      expect(toonShown.stdout).not.toContain("activeBlocker");

      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const changes = yield* openSqliteChangePersistence();
          const raised = yield* changes.raiseImplementationBlocker({
            changeId,
            content: "Wait for an external decision.",
            now: commandNow,
          });
          if (!raised.ok) throw new Error(raised.code);
        }),
      );
      const blocked = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
      expect(JSON.parse(blocked.stdout).task.change).toEqual({
        id: changeId,
        activity: "blocked",
      });
      const blockedList = yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"]);
      expect(
        JSON.parse(blockedList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "blocked" });
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const changes = yield* openSqliteChangePersistence();
          const resolved = yield* changes.resolveImplementationBlocker({
            changeId,
            content: "Proceed with the accepted implementation.",
            now: commandNow,
          });
          if (!resolved.ok) throw new Error(resolved.code);
        }),
      );

      expect(
        JSON.parse((yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"])).stdout)
          .tasks,
      ).toContainEqual(
        expect.objectContaining({
          id: "BY-1",
          change: { id: changeId, activity: "implementing" },
        }),
      );

      const candidate = yield* captureCandidateFixture(
        root,
        changeId,
        startedView.branch,
        "projection-head",
        firstNow,
      );
      const activeValidation = yield* withValidationPersistence(root, (persistence) =>
        persistence.startOrReuse({
          candidateId: candidate.id,
          headSha: candidate.headSha,
          policy: { checks: [], copyFiles: [] },
          now: commandNow,
        }),
      );
      if (activeValidation.reused) throw new Error("Expected an active Validation Run");
      const validating = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
      expect(JSON.parse(validating.stdout).task.change).toEqual({
        id: changeId,
        activity: "validating",
      });
      const validatingList = yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"]);
      expect(
        JSON.parse(validatingList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "validating" });

      yield* withValidationPersistence(root, (persistence) =>
        persistence.complete({
          validationRunId: activeValidation.validationRunId,
          outcome: "passed",
          now: commandNow,
        }),
      );
      const ready = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
      expect(JSON.parse(ready.stdout).task.change).toEqual({
        id: changeId,
        activity: "ready",
      });
      const readyList = yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"]);
      expect(
        JSON.parse(readyList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "ready" });

      yield* transitionTaskFixture(root, "validating");
      expect(
        JSON.parse((yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"])).stdout)
          .task.state,
      ).toBe("validating");

      yield* transitionTaskFixture(root, "ready");
      expect(
        JSON.parse((yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"])).stdout)
          .task.state,
      ).toBe("ready");

      yield* completeChangeFixture(root, changeId);
      const completed = yield* runByInProcessEffect(root, ["--json", "change", "show", changeId]);
      expect(JSON.parse(completed.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "completed" },
        cleanup: { state: "pending", blockingReason: null },
      });
      const closedTask = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
      expect(JSON.parse(closedTask.stdout).task).toMatchObject({
        state: "done",
        change: { id: changeId },
      });
      expect(JSON.parse(closedTask.stdout).task.change).not.toHaveProperty("activity");
      const closedList = yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"]);
      expect(
        JSON.parse(closedList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId });
    }),
  );
});

const createChangeFixture = (root: string, branchRef: string, createdAt: string) => {
  const id = randomUUID();
  return withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Change fixture",
        (sql) => sql`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (
          ${id}, ${join(root, ".git")}, ${branchRef}, NULL, 'open',
          NULL, ${createdAt}, ${createdAt}, NULL
        )
      `,
      );
      return { id };
    }),
  );
};

const closeChangeFixture = (
  root: string,
  changeId: string,
  reason: "cancelled" | "completed",
  closedAt: string,
) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change fixture",
        (sql) => sql`
        UPDATE changes
        SET
          state = 'closed',
          close_reason = ${reason},
          closed_at = ${closedAt},
          updated_at = ${closedAt},
          cleanup_state = 'pending'
        WHERE id = ${changeId}
      `,
      );
    }),
  );

const captureCandidateFixture = (
  root: string,
  changeId: string,
  branchRef: string,
  headSha: string,
  capturedAt: string,
) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const capture = yield* openSqliteCandidateCapturePersistence();
      const result = yield* capture.commitCapture({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef,
        expectedChangeId: changeId,
        baseRef: "refs/remotes/origin/main",
        changeBaseSha: "target-sha",
        headSha,
        now: capturedAt,
      });
      if (!result.ok) throw new Error(result.code);
      return { id: result.candidateId, headSha };
    }),
  );

const transitionTaskFixture = (root: string, state: "validating" | "ready") =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const result = yield* tasks.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: state,
        now: commandNow,
      });
      if (!result.ok) throw new Error(result.code);
    }),
  );

const completeChangeFixture = (root: string, changeId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const changes = yield* openSqliteChangePersistence();
      const result = yield* changes.completeMergedChange({ changeId, now: commandNow });
      if (!result.ok) throw new Error(result.code);
    }),
  );

const withValidationPersistence = <A, E>(
  root: string,
  use: (persistence: ChangeValidationPersistence) => Effect.Effect<A, E>,
) =>
  Effect.flatMap(openSqliteChangeValidationPersistence(), use).pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
        commonDirectory: join(root, ".git"),
      }),
    ),
  );
