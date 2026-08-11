import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, vi } from "vitest";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import {
  CandidateValidation,
  type CandidateValidationService,
  type ValidateCandidateInput,
} from "../../src/change/candidateValidation/validateCandidate.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import type { ReviewerOutput } from "../../src/contracts/reviewerOutput.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
} from "../support/candidateReadyRepo.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import { withTestRepository } from "../support/repository.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-07-15T10:00:00.000Z";

describe("Candidate validation", () => {
  it.scoped(
    "copies a regular local validation file from the main checkout without changing Candidate identity",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const candidateCheckout = join(commonDirectory(mainCheckout), "candidate-worktree");
        git(
          mainCheckout,
          "worktree",
          "add",
          "-q",
          "-b",
          "linked-candidate",
          candidateCheckout,
          "HEAD",
        );
        const captured = yield* captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        writeFileSync(join(mainCheckout, ".validation-env"), "source=main\n");
        writeFileSync(join(candidateCheckout, ".validation-env"), "source=candidate\n");

        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const result = yield* validateCandidate(validation, {
          changeId: captured.changeId,
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
          policy: {
            checks: [
              {
                id: "reads-main-env",
                command: "grep -qx 'source=main' .validation-env",
                timeoutSeconds: 1,
              },
            ],
            copyFiles: [".validation-env"],
            specialistReviews: [],
          },
          now,
        });

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        if (!result.ok) return;
        expect(yield* validation.listRounds(result.validationRunId)).toEqual([
          { producer: "reads-main-env", status: "passed" },
        ]);
        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
      }),
    15_000,
  );

  it.scoped(
    "persists a Candidate-integrity Tooling Failure and preserves the Candidate",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const candidateCheckout = join(commonDirectory(mainCheckout), "candidate-worktree");
        git(
          mainCheckout,
          "worktree",
          "add",
          "-q",
          "-b",
          "linked-candidate",
          candidateCheckout,
          "HEAD",
        );
        writeFileSync(join(candidateCheckout, "candidate.txt"), "original\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "candidate");
        const captured = yield* captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;

        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const result = yield* validateCandidate(validation, {
          changeId: captured.changeId,
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
          policy: {
            prepare: { command: "printf changed > candidate.txt", timeoutSeconds: 1 },
            checks: [{ id: "skipped", command: "true", timeoutSeconds: 1 }],
            copyFiles: [],
            specialistReviews: [],
          },
          now,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          state: "complete",
          outcome: "tooling_failed",
        });
        expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ operationName: "verify_candidate_head" }),
          ]),
        );
        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
        expect(git(candidateCheckout, "status", "--porcelain")).toBe("");
        expect(git(candidateCheckout, "show", "HEAD:candidate.txt")).toBe("original");
      }),
    15_000,
  );

  it.scoped(
    "prepares each changed Candidate in a fresh exact-Candidate workspace before its Check",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const candidateCheckout = join(commonDirectory(mainCheckout), "candidate-worktree");
        const callLog = join(createTestWorkspace(), "validation-calls");
        git(
          mainCheckout,
          "worktree",
          "add",
          "-q",
          "-b",
          "linked-candidate",
          candidateCheckout,
          "HEAD",
        );
        writeFileSync(join(candidateCheckout, "candidate.txt"), "first\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "first candidate");
        const first = yield* captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const canonicalGitignoreContent = readFileSync(join(mainCheckout, ".gitignore"), "utf8");
        writeFileSync(join(mainCheckout, ".gitignore"), "dirty canonical content\n");
        writeFileSync(join(mainCheckout, "dirty-only.txt"), "canonical checkout only\n");
        const dirtyCanonicalStatus = git(mainCheckout, "status", "--porcelain");

        const prepare = `gitdir="$(git rev-parse --git-dir)"; printf P >> "${callLog}"; printf prepared > "$gitdir/.but-why-prepared"`;
        const validationPolicy = (headSha: string, content: string) => ({
          prepare: { command: prepare, timeoutSeconds: 1 },
          checks: [
            {
              id: "prepared",
              command: `test "$(git rev-parse HEAD)" = "${headSha}" && test "$(cat candidate.txt)" = "${content}" && ! grep -q "dirty canonical content" .gitignore && test ! -e dirty-only.txt && test -f "$(git rev-parse --git-dir)/.but-why-prepared" && printf C >> "${callLog}"`,
              timeoutSeconds: 1,
            },
          ],
          copyFiles: [],
          specialistReviews: [],
        });
        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const firstPolicy = validationPolicy(first.headSha, "first");
        const firstResult = yield* validateCandidate(validation, {
          changeId: first.changeId,
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
          policy: firstPolicy,
          now,
        });
        expect(firstResult).toMatchObject({ ok: true, outcome: "passed", reused: false });
        if (!firstResult.ok) throw new Error("Expected a passed first Validation Run");
        expect(readFileSync(callLog, "utf8")).toBe("PC");
        expect(readFileSync(join(mainCheckout, ".gitignore"), "utf8")).toBe(
          "dirty canonical content\n",
        );
        expect(readFileSync(join(mainCheckout, "dirty-only.txt"), "utf8")).toBe(
          "canonical checkout only\n",
        );
        expect(git(mainCheckout, "status", "--porcelain")).toBe(dirtyCanonicalStatus);

        rmSync(join(mainCheckout, "dirty-only.txt"));
        writeFileSync(join(mainCheckout, ".gitignore"), canonicalGitignoreContent);
        writeFileSync(join(candidateCheckout, "candidate.txt"), "second\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "second candidate");
        const secondNow = "2026-07-15T12:01:00.000Z";
        const second = yield* captureLocalCandidate({ cwd: candidateCheckout, now: secondNow });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const secondPolicy = validationPolicy(second.headSha, "second");
        const secondResult = yield* validateCandidate(validation, {
          changeId: second.changeId,
          candidateId: second.candidateId,
          changeBaseSha: second.changeBaseSha,
          headSha: second.headSha,
          policy: secondPolicy,
          now: secondNow,
        });
        expect(secondResult).toMatchObject({ ok: true, outcome: "passed", reused: false });
        if (!secondResult.ok) throw new Error("Expected a passed second Validation Run");
        expect(secondResult).not.toMatchObject({ validationRunId: firstResult.validationRunId });
        expect(readFileSync(callLog, "utf8")).toBe("PCPC");

        const historicalCandidateError = yield* validateCandidate(validation, {
          changeId: first.changeId,
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
          policy: firstPolicy,
          now: secondNow,
        }).pipe(Effect.flip);
        expect(historicalCandidateError).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(readFileSync(callLog, "utf8")).toBe("PCPC");

        const workspaces = yield* withTestRepository(
          mainCheckout,
          Effect.gen(function* () {
            const repository = yield* RepositorySql;
            return yield* repository.operation(
              "inspect Snapshot Workspaces",
              (sql) =>
                sql<{
                  readonly validationRunId: string;
                  readonly submittedSha: string;
                  readonly worktreePath: string;
                }>`
                SELECT validation_run_id AS validationRunId,
                  expected_commit_sha AS submittedSha,
                  workspace_path AS worktreePath
                FROM candidate_snapshot_workspaces
                ORDER BY created_at ASC, validation_run_id ASC
              `,
            );
          }),
        );
        expect(workspaces).toHaveLength(2);
        expect(workspaces.map(({ validationRunId }) => validationRunId)).toEqual(
          expect.arrayContaining([firstResult.validationRunId, secondResult.validationRunId]),
        );
        const firstWorkspace = workspaces.find(
          ({ submittedSha }) => submittedSha === first.headSha,
        );
        const secondWorkspace = workspaces.find(
          ({ submittedSha }) => submittedSha === second.headSha,
        );
        expect(firstWorkspace?.validationRunId).toBe(firstResult.validationRunId);
        expect(secondWorkspace?.validationRunId).toBe(secondResult.validationRunId);
        expect(firstWorkspace?.worktreePath).not.toBe(secondWorkspace?.worktreePath);
        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(second.headSha);
        expect(git(candidateCheckout, "status", "--porcelain")).toBe("");
      }),
    15_000,
  );

  it.scoped(
    "runs the fixed task-backed Validation Gate and hands a Specialist Finding to its outcome",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout, now });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        yield* withTestRepository(
          mainCheckout,
          Effect.flatMap(RepositorySql, (repository) =>
            repository.operation("install current Acceptance Context", (sql) =>
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
                  VALUES ('BY-1', 1, 'Validate the fixed Gate',
                    'Run each eligible phase in its fixed order.', 'todo', ${now}, ${now})
                `;
                yield* sql`
                  UPDATE changes SET task_id = 'BY-1', acceptance_context = ${JSON.stringify({
                    version: 1,
                    title: "Validate the fixed Gate",
                    description: "Run each eligible phase in its fixed order.",
                  })}, base_remote_url = 'https://github.com/acme/repo.git',
                    starting_commit = ${captured.changeBaseSha}, worktree_path = ${mainCheckout}
                  WHERE id = ${captured.changeId}
                `;
              }),
            ),
          ),
        );
        const callLog = join(createTestWorkspace(), "gate-calls");
        const reviewWorkspaces: string[] = [];
        const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(
          ({ reviewer, commandCwd }) =>
            Effect.sync(() => {
              if (commandCwd === undefined) throw new Error(`${reviewer} has no workspace path.`);
              reviewWorkspaces.push(commandCwd);
              const gitDir = git(commandCwd, "rev-parse", "--path-format=absolute", "--git-dir");
              if (!readFileSync(join(gitDir, ".gate-order"), "utf8").endsWith("PC")) {
                throw new Error(`${reviewer} started before Repository Preparation and Checks.`);
              }
              if (reviewer === "acceptance") {
                writeFileSync(join(gitDir, ".acceptance-complete"), "accepted\n");
                writeFileSync(callLog, "A", { flag: "a" });
              } else {
                if (
                  !readFileSync(join(gitDir, ".acceptance-complete"), "utf8").includes("accepted")
                ) {
                  throw new Error("Specialist Review started before Acceptance Review.");
                }
                writeFileSync(callLog, "S", { flag: "a" });
              }
              return {
                ok: true as const,
                report: {
                  findings:
                    reviewer === "standards"
                      ? [
                          {
                            title: "Specialist Finding",
                            description: "Specialist Finding description",
                            evidence: "Specialist Finding evidence",
                            files: [],
                            artifactRefs: [],
                          },
                        ]
                      : [],
                },
                attempts: 1,
                stdout: `${reviewer} completed`,
              };
            }),
        );
        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          reviewerAgentRuntime: { review },
        });
        const result = yield* validateAcceptanceContextCandidate(validation, {
          changeId: captured.changeId,
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
          policy: {
            prepare: {
              command: `gitdir="$(git rev-parse --git-dir)"; printf P >> "${callLog}"; printf P > "$gitdir/.gate-order"`,
              timeoutSeconds: 1,
            },
            checks: [
              {
                id: "gate-check",
                command: `gitdir="$(git rev-parse --git-dir)"; test "$(cat "$gitdir/.gate-order")" = P; printf C >> "${callLog}"; printf C >> "$gitdir/.gate-order"`,
                timeoutSeconds: 1,
              },
            ],
            copyFiles: [],
            acceptanceReview: reviewerPolicy("acceptance"),
            specialistReviews: [{ id: "standards", ...reviewerPolicy("standards") }],
          },
          now,
        });

        expect(result).toMatchObject({ ok: true, outcome: "blocked", reused: false });
        if (!result.ok) return;
        expect(readFileSync(callLog, "utf8")).toBe("PCAS");
        expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
          "acceptance",
          "standards",
        ]);
        expect(new Set(reviewWorkspaces).size).toBe(1);
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          state: "complete",
          outcome: "blocked",
        });
        expect(yield* validation.listFindings(result.validationRunId)).toEqual([
          expect.objectContaining({ producer: "standards", title: "Specialist Finding" }),
        ]);
        expect(yield* validation.listRounds(result.validationRunId)).toEqual([
          { producer: "prepare", status: "passed" },
          { producer: "gate-check", status: "passed" },
          { producer: "acceptance", status: "passed" },
          { producer: "standards", status: "failed" },
        ]);
        expect(git(mainCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
        expect(git(mainCheckout, "status", "--porcelain")).toBe("");
      }),
    10_000,
  );
});

const validateCandidate = (
  validation: ReturnType<typeof candidateValidationForTest>,
  input: ValidateCandidateInput,
) =>
  Effect.gen(function* () {
    const service = yield* CandidateValidation;
    return yield* service.validateCandidate(input);
  }).pipe(Effect.provide(validation.layer));

const validateAcceptanceContextCandidate = (
  validation: ReturnType<typeof candidateValidationForTest>,
  input: Parameters<CandidateValidationService["validateAcceptanceContextCandidate"]>[0],
) =>
  Effect.gen(function* () {
    const service = yield* CandidateValidation;
    return yield* service.validateAcceptanceContextCandidate(input);
  }).pipe(Effect.provide(validation.layer));

const reviewerPolicy = (name: string) => ({
  instructions: `${name} instructions`,
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: name,
    scope: "repo" as const,
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: `${name}-model` },
    },
  },
});

const repositoryConfig = (root: string) => ({
  statePath: candidateRepositoryConfig(root).statePath,
  commonDirectory: commonDirectory(root),
});
