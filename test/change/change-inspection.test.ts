import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/contracts/reviewerOutput.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import {
  captureCandidateFixture,
  closeChangeFixture,
  completeValidationRunFixture,
  createChangeFixture,
  createFindingFixture,
  createImplementationBlockerFixture,
  createInspectionRepository,
  createTaskFixture,
  createToolingFailureFixture,
  createValidationRunFixture,
  recordImplementationDecisionFixture,
  resolveImplementationBlockerFixture,
  runInspectionCommand,
} from "../support/changeInspectionFixture.js";
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

// Retained evidence owners after broad workflow setup was removed:
// - Change Submit Candidate selection: change-submit-orchestration.test.ts.
// - Validation and Finding writers: candidate-validation-inspection.test.ts and
//   candidate-acceptance-review.test.ts.
// - Submit result and structured storage-error output: change-submit-errors.test.ts and
//   storage-error-mapping.test.ts.
// This file retains the real-Git inference and policy-source sentinels because those Claims
// include Git identity and exact Change Base and Candidate policy authority.
describe("Change inspection CLI", () => {
  it.effect("infers the Change from its Managed Worktree and rejects the main checkout", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(root, ["change", "start"]);
      const startedView = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };

      const inferred = yield* runByInProcessEffect(startedView.worktreePath, ["change", "show"]);
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
        "change",
        "show",
      ]);
      const explicit = yield* runByInProcessEffect(root, ["change", "show", startedView.change.id]);

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
      const root = createInspectionRepository();
      const older = yield* createChangeFixture(root, "refs/heads/older", firstNow);
      const newer = yield* createChangeFixture(root, "refs/heads/newer", secondNow);
      yield* closeChangeFixture(root, newer.id, "cancelled", secondNow);

      const defaultResult = yield* runInspectionCommand(root, ["change", "list"], commandNow);
      const allResult = yield* runInspectionCommand(root, ["change", "list", "--all"], commandNow);
      const openShown = yield* runInspectionCommand(root, ["change", "show", older.id]);
      const closedShown = yield* runInspectionCommand(root, ["change", "show", newer.id]);

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
        pullRequest: null,
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(JSON.parse(closedShown.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "cancelled" },
        cleanup: { state: "pending", blockingReason: null },
      });
    }),
  );

  it.effect("reports malformed persisted data as persisted_data_invalid", () =>
    Effect.gen(function* () {
      const root = createInspectionRepository();
      const change = yield* createChangeFixture(root, "refs/heads/malformed", firstNow);
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "corrupt Change publication marker",
            (sql) => sql`
              UPDATE changes
              SET publication_candidate_id = 'candidate-malformed'
              WHERE id = ${change.id}
            `,
          );
        }),
      );

      const result = yield* runInspectionCommand(root, ["change", "show", change.id]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "persisted_data_invalid",
          message: "Shared But Why? state contains malformed persisted data.",
          operation: "read Change",
        },
        help: [
          "Replace <git-common-dir>/but-why/state.sqlite with a known-good copy, then retry the command.",
        ],
      });
    }),
  );

  it.effect("inspects current Findings and orders Validation Run History across Candidates", () =>
    Effect.gen(function* () {
      const root = createInspectionRepository();
      const change = yield* createChangeFixture(root, "refs/heads/history", firstNow);
      const firstCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "first-head",
        firstNow,
      );
      const secondCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "second-head",
        secondNow,
      );
      const olderCandidateRun = yield* createValidationRunFixture(root, {
        changeId: change.id,
        candidateId: firstCandidate.id,
        state: "complete",
        outcome: "passed",
        createdAt: commandNow,
        updatedAt: commandNow,
      });
      const newerRun = yield* createValidationRunFixture(root, {
        changeId: change.id,
        candidateId: secondCandidate.id,
        state: "running",
        outcome: null,
        createdAt: secondNow,
        updatedAt: secondNow,
      });
      yield* createFindingFixture(root, {
        id: `${newerRun.validationRunId}-F1`,
        validationRunId: newerRun.validationRunId,
        createdAt: commandNow,
      });
      yield* createToolingFailureFixture(root, newerRun.validationRunId, commandNow);
      const findings = yield* runInspectionCommand(root, ["change", "findings", change.id]);
      const history = yield* runInspectionCommand(root, ["change", "validation-runs", change.id]);
      const shown = yield* runInspectionCommand(root, ["change", "show", change.id]);

      expect(findings.stdout).not.toContain('"severity"');
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

  it.effect("keeps non-review policy from Change Base while using Candidate reviewer config", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          { taskPrefix: "BY", validation: { checks: [{ id: "base", command: "true" }] } },
          null,
          2,
        )}\n`,
      );
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(root, ["change", "start"], firstNow);
      const change = JSON.parse(started.stdout) as {
        readonly change: { readonly id: string };
        readonly worktreePath: string;
      };

      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          {
            taskPrefix: "BY",
            validation: { checks: [{ id: "caller", command: "false" }] },
            review: { specialists: ["caller"] },
            reviewers: {
              caller: {
                instructionsFile: ".but-why/reviewers/caller.md",
                agentProfile: { scope: "repo", name: "caller" },
              },
            },
            agentProfiles: {
              caller: { agentRuntime: "pi", runtimeConfig: { model: "caller/model" } },
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(change.worktreePath, ".but-why", "config.json"),
        `${JSON.stringify(
          {
            taskPrefix: "BY",
            validation: { checks: [{ id: "managed", command: "false" }] },
            review: { specialists: ["candidate"] },
            reviewers: {
              candidate: {
                instructionsFile: ".but-why/reviewers/candidate.md",
                agentProfile: { scope: "repo", name: "candidate" },
              },
            },
            agentProfiles: {
              candidate: { agentRuntime: "pi", runtimeConfig: { model: "candidate/model" } },
            },
          },
          null,
          2,
        )}\n`,
      );
      mkdirSync(join(change.worktreePath, ".but-why", "reviewers"), { recursive: true });
      writeFileSync(
        join(change.worktreePath, ".but-why", "reviewers", "candidate.md"),
        "Review Candidate policy authority.\n",
      );
      runTestProcessOrThrow("git", ["config", "user.name", "But Why Test"], {
        cwd: change.worktreePath,
      });
      runTestProcessOrThrow("git", ["config", "user.email", "but-why@example.test"], {
        cwd: change.worktreePath,
      });
      runTestProcessOrThrow(
        "git",
        ["add", ".but-why/config.json", ".but-why/reviewers/candidate.md"],
        { cwd: change.worktreePath },
      );
      runTestProcessOrThrow("git", ["commit", "-m", "Use Candidate reviewer policy"], {
        cwd: change.worktreePath,
      });

      const reviewedProfiles: string[] = [];
      const reviewerAgentRuntime: ReviewerAgentRuntime<ReviewerOutput> = {
        review: (input) =>
          Effect.sync(() => {
            reviewedProfiles.push(
              `${input.reviewer}:${input.profile.agentProfile}:${input.profile.profile.runtimeConfig?.model ?? "<unset>"}`,
            );
            return {
              ok: true as const,
              report: {
                findings: [
                  {
                    title: "Candidate reviewer selected",
                    description: "The Candidate reviewer supplied this sentinel Finding.",
                    evidence: "Candidate reviewer policy reached the reviewer runtime.",
                    files: [".but-why/config.json"],
                    artifactRefs: [],
                  },
                ],
              },
              attempts: 1,
              stdout: "Candidate reviewer selected",
            };
          }),
      };
      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id],
        firstNow,
        { reviewerAgentRuntime },
      );
      const output = JSON.parse(result.stdout) as {
        readonly error: { readonly code: string };
      };

      expect(result.status).toBe(1);
      expect(output.error.code).toBe("validation_findings");
      expect(reviewedProfiles).toEqual(["candidate:candidate:candidate/model"]);
      expect(result.stdout).toContain("Candidate reviewer selected");
      expect(result.stdout).not.toContain("command: false");
      expect(result.stdout).not.toContain('"severity"');
    }),
  );

  it.effect(
    "lists directly persisted Implementation Decisions in order through Change inspection",
    () =>
      Effect.gen(function* () {
        const root = createInspectionRepository();
        const change = yield* createChangeFixture(root, "refs/heads/decisions", firstNow);
        yield* recordImplementationDecisionFixture(root, change.id, {
          choice: "Use an append-only record",
          rationale: "Keep material choices separate from rationale.",
          now: commandNow,
        });
        yield* recordImplementationDecisionFixture(root, change.id, {
          choice: "Keep the decision log one-line",
          rationale: "Match the one-line Choice contract.",
          now: commandNow,
        });
        const listed = yield* runInspectionCommand(root, ["change", "decision", "list", change.id]);
        const shown = yield* runInspectionCommand(root, ["change", "show", change.id]);

        expect(JSON.parse(listed.stdout)).toMatchObject({
          changeId: change.id,
          count: 2,
          decisions: [
            {
              changeId: change.id,
              sequence: 1,
              choice: "Use an append-only record",
              rationale: "Keep material choices separate from rationale.",
            },
            {
              changeId: change.id,
              sequence: 2,
              choice: "Keep the decision log one-line",
              rationale: "Match the one-line Choice contract.",
            },
          ],
        });
        expect(JSON.parse(shown.stdout).implementationDecisions).toMatchObject([
          { sequence: 1, choice: "Use an append-only record" },
          { sequence: 2, choice: "Keep the decision log one-line" },
        ]);
      }),
  );

  it.effect(
    "rejects invalid Implementation Decision input and exposes command help through the Change CLI",
    () =>
      Effect.gen(function* () {
        const root = createInspectionRepository();
        const change = yield* createChangeFixture(root, "refs/heads/decisions", firstNow);
        const missing = yield* runInspectionCommand(root, ["change", "decision", "add", change.id]);
        const empty = yield* runInspectionCommand(root, [
          "change",
          "decision",
          "add",
          change.id,
          "--choice",
          "",
          "--rationale",
          "A reason",
        ]);
        const emptyRationale = yield* runInspectionCommand(root, [
          "change",
          "decision",
          "add",
          change.id,
          "--choice",
          "A choice",
          "--rationale",
          "",
        ]);
        const help = yield* runInspectionCommand(root, ["change", "decision", "add", "--help"]);
        const blockerHelp = yield* runInspectionCommand(root, [
          "change",
          "blocker",
          "raise",
          "--help",
        ]);
        const multiline = yield* runInspectionCommand(root, [
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

  it.effect("projects linked Change progress through Task inspection", () =>
    Effect.gen(function* () {
      const root = createInspectionRepository();
      yield* createTaskFixture(root, {
        id: "BY-1",
        numericId: 1,
        title: "Task-backed Change",
        description: "Inspect progress",
        state: "todo",
        createdAt: firstNow,
        updatedAt: secondNow,
      });

      const branch = "refs/heads/projection";
      const change = yield* createChangeFixture(root, branch, firstNow, { taskId: "BY-1" });
      const changeId = change.id;
      const shown = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);

      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "Task-backed Change",
          state: "todo",
          change: { id: changeId, activity: "implementing" },
        },
      });
      expect(JSON.parse(shown.stdout).task).not.toHaveProperty("startable");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("state");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("readiness");
      expect(JSON.parse(shown.stdout).task.change).not.toHaveProperty("activeBlocker");
      const defaultShown = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);
      const defaultOutput = JSON.parse(defaultShown.stdout);
      expect(defaultOutput).toMatchObject({
        task: { change: { id: changeId, activity: "implementing" } },
      });
      expect(defaultOutput.task.change).not.toHaveProperty("startable");
      expect(defaultOutput.task.change).not.toHaveProperty("readiness");
      expect(defaultOutput.task.change).not.toHaveProperty("activeBlocker");

      yield* createImplementationBlockerFixture(root, changeId, {
        reportedAt: firstNow,
        resolvedAt: secondNow,
        resolutionContent: "The earlier issue was resolved.",
      });
      const activeBlocker = yield* createImplementationBlockerFixture(root, changeId, {
        reportedAt: commandNow,
      });
      const blocked = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);
      expect(JSON.parse(blocked.stdout).task.change).toEqual({
        id: changeId,
        activity: "blocked",
      });
      const blockedList = yield* runInspectionCommand(root, ["task", "list", "--all"]);
      expect(
        JSON.parse(blockedList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "blocked" });
      const blockerHistory = yield* runInspectionCommand(root, [
        "change",
        "blocker",
        "list",
        changeId,
      ]);
      expect(JSON.parse(blockerHistory.stdout)).toMatchObject({
        changeId,
        active: { id: activeBlocker.id },
        blockers: [
          { sequence: 1, resolvedAt: secondNow },
          { sequence: 2, id: activeBlocker.id, resolvedAt: null },
        ],
      });
      yield* resolveImplementationBlockerFixture(root, activeBlocker.id, commandNow);

      expect(
        JSON.parse((yield* runInspectionCommand(root, ["task", "list", "--all"])).stdout).tasks,
      ).toContainEqual(
        expect.objectContaining({
          id: "BY-1",
          change: { id: changeId, activity: "implementing" },
        }),
      );

      const candidate = yield* captureCandidateFixture(root, changeId, "projection-head", firstNow);
      const activeValidation = yield* createValidationRunFixture(root, {
        changeId,
        candidateId: candidate.id,
        state: "running",
        outcome: null,
        createdAt: commandNow,
        updatedAt: commandNow,
      });
      const validating = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);
      expect(JSON.parse(validating.stdout).task.change).toEqual({
        id: changeId,
        activity: "validating",
      });
      const validatingList = yield* runInspectionCommand(root, ["task", "list", "--all"]);
      expect(
        JSON.parse(validatingList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "validating" });

      yield* completeValidationRunFixture(
        root,
        activeValidation.validationRunId,
        "passed",
        commandNow,
      );
      const ready = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);
      expect(JSON.parse(ready.stdout).task.change).toEqual({
        id: changeId,
        activity: "ready",
      });
      const readyList = yield* runInspectionCommand(root, ["task", "list", "--all"]);
      expect(
        JSON.parse(readyList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId, activity: "ready" });
      expect(
        JSON.parse((yield* runInspectionCommand(root, ["task", "show", "BY-1"])).stdout).task.state,
      ).toBe("todo");

      yield* closeChangeFixture(root, changeId, "completed", commandNow);
      const completed = yield* runInspectionCommand(root, ["change", "show", changeId]);
      expect(JSON.parse(completed.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "completed" },
        cleanup: { state: "pending", blockingReason: null },
      });
      const closedTask = yield* runInspectionCommand(root, ["task", "show", "BY-1"]);
      expect(JSON.parse(closedTask.stdout).task).toMatchObject({
        state: "done",
        change: { id: changeId },
      });
      expect(JSON.parse(closedTask.stdout).task.change).not.toHaveProperty("activity");
      const closedList = yield* runInspectionCommand(root, ["task", "list", "--all"]);
      expect(
        JSON.parse(closedList.stdout).tasks.find(
          (task: { readonly id: string }) => task.id === "BY-1",
        ).change,
      ).toEqual({ id: changeId });
    }),
  );
});
