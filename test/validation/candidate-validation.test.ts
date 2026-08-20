import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, vi } from "vitest";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { AgentSessionPersistence } from "../../src/agent/agentSession/agentSession.js";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import {
  CandidateValidation,
  type CandidateValidationService,
  type ValidateCandidateInput,
} from "../../src/change/candidateValidation/validateCandidate.js";
import { internalChangeId } from "../../src/change/changeId.js";
import { makeCreateSnapshotWorkspace } from "../../src/change/validation/createSnapshotWorkspace.js";
import { InfrastructureToolingFailed } from "../../src/change/validation/validationToolingFailures.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import type { RunDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
  registerCandidateChange,
  setCandidateChangePolicy,
} from "../support/candidateReadyRepo.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import { withTestRepository } from "../support/repository.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Candidate validation", () => {
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
        registerCandidateChange(mainCheckout, "refs/heads/linked-candidate", candidateCheckout);
        setCandidateChangePolicy(mainCheckout, "refs/heads/linked-candidate", {
          prepare: { command: "printf changed > candidate.txt", timeoutSeconds: 1 },
          checks: [{ id: "skipped", command: "true", timeoutSeconds: 1 }],
        });
        writeFileSync(join(candidateCheckout, "candidate.txt"), "original\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "candidate");
        const captured = yield* captureLocalCandidate({ cwd: candidateCheckout });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;

        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const result = yield* validateCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          state: "complete",
          outcome: "tooling_failed",
        });
        expect(yield* validation.listPhaseResults(result.validationRunId)).toEqual([
          { producer: "prepare", outcome: "failed" },
        ]);
        expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual([
          expect.objectContaining({ operationName: "verify_candidate_head" }),
        ]);
        const failureScopes = yield* withTestRepository(
          mainCheckout,
          Effect.flatMap(RepositorySql, (repository) =>
            repository.operation(
              "inspect Validation Tooling Failure scope",
              (sql) =>
                sql<{
                  readonly phaseToolingFailure: string | null;
                  readonly runToolingFailure: string | null;
                }>`
                SELECT
                  validation_phase_results.tooling_failure AS phaseToolingFailure,
                  validation_runs.run_tooling_failure AS runToolingFailure
                FROM validation_runs
                JOIN validation_phase_results
                  ON validation_phase_results.validation_run_id = validation_runs.id
                WHERE validation_runs.id = ${result.validationRunId}
              `,
            ),
          ),
        );
        expect(failureScopes).toEqual([
          {
            phaseToolingFailure: expect.stringContaining("verify_candidate_head"),
            runToolingFailure: null,
          },
        ]);
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
        registerCandidateChange(mainCheckout, "refs/heads/linked-candidate", candidateCheckout);
        writeFileSync(join(candidateCheckout, "candidate.txt"), "first\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "first candidate");
        const first = yield* captureLocalCandidate({ cwd: candidateCheckout });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const canonicalGitignoreContent = readFileSync(join(mainCheckout, ".gitignore"), "utf8");
        writeFileSync(join(mainCheckout, ".gitignore"), "dirty canonical content\n");
        writeFileSync(join(mainCheckout, "dirty-only.txt"), "canonical checkout only\n");
        const dirtyCanonicalStatus = git(mainCheckout, "status", "--porcelain");

        const prepare = `gitdir="$(git rev-parse --git-dir)"; printf P >> "${callLog}"; printf prepared > "$gitdir/.but-why-prepared"`;
        setCandidateChangePolicy(mainCheckout, "refs/heads/linked-candidate", {
          prepare: { command: prepare, timeoutSeconds: 1 },
          checks: [
            {
              id: "prepared",
              command: `case "$(cat candidate.txt)" in first|second) ;; *) exit 1 ;; esac; ! grep -q "dirty canonical content" .gitignore && test ! -e dirty-only.txt && test -f "$(git rev-parse --git-dir)/.but-why-prepared" && printf C >> "${callLog}"`,
              timeoutSeconds: 1,
            },
          ],
        });
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const firstResult = yield* validateCandidate(validation, {
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
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
        const second = yield* captureLocalCandidate({ cwd: candidateCheckout });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const secondResult = yield* validateCandidate(validation, {
          candidateId: second.candidateId,
          changeBaseSha: second.changeBaseSha,
          headSha: second.headSha,
        });
        expect(secondResult).toMatchObject({ ok: true, outcome: "passed", reused: false });
        if (!secondResult.ok) throw new Error("Expected a passed second Validation Run");
        expect(secondResult).not.toMatchObject({ validationRunId: firstResult.validationRunId });
        expect(readFileSync(callLog, "utf8")).toBe("PCPC");

        const historicalCandidateError = yield* validateCandidate(validation, {
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
        }).pipe(Effect.flip);
        expect(historicalCandidateError).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(readFileSync(callLog, "utf8")).toBe("PCPC");

        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(second.headSha);
        expect(git(candidateCheckout, "status", "--porcelain")).toBe("");
      }),
    15_000,
  );

  it.scoped(
    "records a dispatch Tooling Failure and cleans the Snapshot Workspace",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        if (!captured.ok) throw new Error(captured.code);
        yield* installAcceptanceContext(mainCheckout, captured.changeId);
        const agentPersistence: AgentSessionPersistence = {
          beginInvocation: () =>
            Effect.succeed({
              ok: false as const,
              code: "concurrent_unsettled_invocation" as const,
              invocationId: 73,
            }),
          settleInvocation: () => Effect.void,
          readInvocationHistory: () => Effect.succeed([]),
        };
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          agentPersistence,
        });

        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          state: "complete",
          outcome: "tooling_failed",
          cleanup: { state: "complete", blockingReason: null },
        });
        expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual([
          expect.objectContaining({
            operationName: "dispatch_agent_invocation",
            errorMessage: expect.stringContaining("Agent Invocation 73"),
            blockingInvocationId: 73,
          }),
        ]);
        const shown = yield* runByInProcessEffect(mainCheckout, [
          "validation-run",
          "show",
          String(result.validationRunId),
        ]);
        expect(shown.status).toBe(0);
        expect(JSON.parse(shown.stdout)).toMatchObject({
          toolingFailures: [
            expect.objectContaining({
              operationName: "dispatch_agent_invocation",
              errorMessage: expect.stringContaining("Agent Invocation 73"),
              blockingInvocationId: 73,
            }),
          ],
        });
      }),
    10_000,
  );

  it.scoped(
    "does not link the blocking Agent Invocation during Change Validation dispatch",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        if (!captured.ok) throw new Error(captured.code);
        yield* installAcceptanceContext(mainCheckout, captured.changeId);
        const first = yield* withTestRepository(
          mainCheckout,
          Effect.gen(function* () {
            const agents = yield* openSqliteAgentSessionPersistence();
            const started = yield* agents.beginInvocation({
              configuration: { harness: "pi" as const, model: "test-model" },
              createdAt: "2026-08-14T12:00:00.000Z",
              linkInvocation: () => Effect.void,
            });
            if (!started.ok) throw new Error(`Agent Invocation setup failed: ${started.code}`);
            const repository = yield* RepositorySql;
            yield* repository.operation(
              "assign acceptance Agent Session fixture",
              (sql) => sql`
                INSERT INTO change_agent_sessions (change_id, producer, agent_session_id)
                VALUES (${internalChangeId(captured.changeId, repository.idPrefix)}, 'acceptance', ${started.dispatch.agentSessionId})
              `,
            );
            return started.dispatch.invocation.id;
          }),
        );
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });

        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual([
          expect.objectContaining({
            operationName: "dispatch_agent_invocation",
            blockingInvocationId: first,
          }),
        ]);
        const evidence = yield* withTestRepository(
          mainCheckout,
          Effect.flatMap(RepositorySql, (repository) =>
            repository.operation(
              "inspect failed Validation Invocation ownership",
              (sql) => sql<{
                readonly linkedCount: number;
                readonly settledAt: string | null;
              }>`
                SELECT
                  (SELECT COUNT(*) FROM validation_phase_agent_invocations
                   WHERE validation_run_id = ${result.validationRunId}) AS linkedCount,
                  invocation.settled_at AS settledAt
                FROM agent_invocations AS invocation
                WHERE invocation.id = ${first}
              `,
            ),
          ),
        );
        expect(evidence).toEqual([{ linkedCount: 0, settledAt: null }]);
      }),
    10_000,
  );

  it.scoped(
    "keeps dispatch evidence and the Validation Run active when cleanup fails",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        if (!captured.ok) throw new Error(captured.code);
        yield* installAcceptanceContext(mainCheckout, captured.changeId);
        const agentPersistence: AgentSessionPersistence = {
          beginInvocation: () =>
            Effect.succeed({
              ok: false as const,
              code: "concurrent_unsettled_invocation" as const,
              invocationId: 73,
            }),
          settleInvocation: () => Effect.die("Dispatch failure must not settle an Invocation"),
          readInvocationHistory: () => Effect.succeed([]),
        };
        const cleanupFailureRunner = ((workspaceInput) =>
          Effect.gen(function* () {
            if (workspaceInput.runInWorkspace !== undefined) {
              yield* Effect.either(
                workspaceInput.runInWorkspace({
                  commandExecutor: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                  worktreePath: workspaceInput.repositoryRoot,
                }),
              );
            }
            yield* workspaceInput.recordWorkspaceCleanup?.({
              workspace: "failed",
              errorMessage: "Cleanup failed.",
            }) ?? Effect.void;
            return yield* Effect.fail(
              new InfrastructureToolingFailed({
                operationName: "dispatch_agent_invocation",
                message: "Agent Invocation 73 dispatch was blocked.",
                blockingInvocationId: 73,
              }) as Error,
            );
          })) as RunDisposableExactCommitWorkspace;
        const cleanupFailureWorkspace = makeCreateSnapshotWorkspace(cleanupFailureRunner);
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          agentPersistence,
          createSnapshotWorkspace: cleanupFailureWorkspace,
        });

        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, code: "active_validation_run" });
        if (!result.ok && "toolingFailures" in result) {
          expect(result.toolingFailures).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                operationName: "dispatch_agent_invocation",
                blockingInvocationId: 73,
              }),
            ]),
          );
        }
        if (result.ok || !("code" in result) || result.code !== "active_validation_run") return;
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          state: "running",
          outcome: null,
          cleanup: { state: "pending", blockingReason: "Cleanup failed." },
        });
        const shown = yield* runByInProcessEffect(mainCheckout, [
          "validation-run",
          "show",
          String(result.validationRunId),
        ]);
        expect(shown.status).toBe(0);
        expect(JSON.parse(shown.stdout)).toMatchObject({
          validationRun: { state: "running", outcome: null },
        });
        expect(JSON.parse(shown.stdout).toolingFailures).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operationName: "dispatch_agent_invocation",
              blockingInvocationId: 73,
            }),
          ]),
        );
      }),
    10_000,
  );

  it.scoped(
    "persists an Acceptance Review Tooling Failure only on its phase through the public service",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        if (!captured.ok) throw new Error(captured.code);
        yield* installAcceptanceContext(mainCheckout, captured.changeId);
        const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed(reviewerFailure("Acceptance output was invalid.")),
        );
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          reviewerAgentRuntime: { review },
        });

        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* toolingFailureScopes(mainCheckout, result.validationRunId)).toEqual([
          {
            phase: "acceptance_review",
            producer: "acceptance",
            phaseToolingFailure: expect.stringContaining("Acceptance output was invalid."),
            runToolingFailure: null,
          },
        ]);
      }),
    10_000,
  );

  it.scoped(
    "persists a Specialist Review Tooling Failure only on its phase through the public service",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        if (!captured.ok) throw new Error(captured.code);
        yield* installAcceptanceContext(mainCheckout, captured.changeId, true);
        const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(({ reviewer }) =>
          Effect.succeed(
            reviewer === "acceptance"
              ? { ok: true as const, report: { findings: [] }, attempts: 1, stdout: "accepted" }
              : reviewerFailure("Specialist output was invalid."),
          ),
        );
        const validation = candidateValidationForTest({
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          reviewerAgentRuntime: { review },
        });

        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        if (result.ok || "code" in result) return;
        expect(yield* toolingFailureScopes(mainCheckout, result.validationRunId)).toEqual([
          {
            phase: "specialist_review",
            producer: "standards",
            phaseToolingFailure: expect.stringContaining("Specialist output was invalid."),
            runToolingFailure: null,
          },
        ]);
      }),
    10_000,
  );

  it.scoped(
    "runs the fixed Validation Gate for a Change linked to a Task and hands a Specialist Finding to its outcome",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const captured = yield* captureLocalCandidate({ cwd: mainCheckout });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        const callLog = join(createTestWorkspace(), "gate-calls");
        yield* withTestRepository(
          mainCheckout,
          Effect.flatMap(RepositorySql, (repository) =>
            repository.operation("install current Acceptance Context", (sql) =>
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO tasks (id, title, description, state)
                  VALUES (1, 'Validate the fixed Gate',
                    'Run each eligible phase in its fixed order.', 'todo')
                `;
                yield* sql`
                  UPDATE changes SET initial_acceptance_context = ${JSON.stringify({
                    version: 1,
                    title: "Validate the fixed Gate",
                    description: "Run each eligible phase in its fixed order.",
                  })}, reviewer_configuration = ${JSON.stringify({
                    acceptanceReview: reviewerPolicy("acceptance"),
                    specialistReviews: [{ id: "standards", ...reviewerPolicy("standards") }],
                  })}, prepare_definition = ${JSON.stringify({
                    command: `gitdir="$(git rev-parse --git-dir)"; printf P >> "${callLog}"; printf P > "$gitdir/.gate-order"`,
                    timeoutSeconds: 1,
                  })}, checks_definition = ${JSON.stringify([
                    {
                      id: "gate-check",
                      command: `gitdir="$(git rev-parse --git-dir)"; test "$(cat "$gitdir/.gate-order")" = P; printf C >> "${callLog}"; printf C >> "$gitdir/.gate-order"`,
                      timeoutSeconds: 1,
                    },
                  ])}, base_remote_url = 'https://github.com/acme/repo.git'
                  WHERE id = ${internalChangeId(captured.changeId, "BY")}
                `;
                yield* sql`
                  INSERT INTO task_change_links (task_id, change_id)
                  VALUES (1, ${internalChangeId(captured.changeId, "BY")})
                `;
              }),
            ),
          ),
        );
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
          localRepositoryRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
          reviewerAgentRuntime: { review },
        });
        const result = yield* validateAcceptanceContextCandidate(validation, {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
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
        expect(yield* validation.listPhaseResults(result.validationRunId)).toEqual([
          { producer: "prepare", outcome: "passed" },
          { producer: "gate-check", outcome: "passed" },
          { producer: "acceptance", outcome: "passed" },
          { producer: "standards", outcome: "failed" },
        ]);
        expect(git(mainCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
        expect(git(mainCheckout, "status", "--porcelain")).toBe("");
      }),
    10_000,
  );
});

const reviewerFailure = (message: string) => ({
  ok: false as const,
  failure: new ReviewerExecutionFailed({
    kind: "output_contract",
    operationName: "decode_reviewer_output",
    diagnostics: [],
    message,
  }),
  sessionUsability: "unknown" as const,
  attempts: 1,
  stdout: "invalid reviewer output",
});

const installAcceptanceContext = (root: string, changeId: string, withSpecialist = false) =>
  withTestRepository(
    root,
    Effect.flatMap(RepositorySql, (repository) =>
      repository.operation("install current Acceptance Context", (sql) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO tasks (id, title, description, state)
            VALUES (1, 'Validate phase ownership', 'Keep Tooling Failure ownership exact.', 'todo')
          `;
          yield* sql`
            UPDATE changes SET initial_acceptance_context = ${JSON.stringify({
              version: 1,
              title: "Validate phase ownership",
              description: "Keep Tooling Failure ownership exact.",
            })}, reviewer_configuration = ${JSON.stringify({
              acceptanceReview: reviewerPolicy("acceptance"),
              specialistReviews: withSpecialist
                ? [{ id: "standards", ...reviewerPolicy("standards") }]
                : [],
            })}, base_remote_url = 'https://github.com/acme/repo.git'
            WHERE id = ${internalChangeId(changeId, "BY")}
          `;
          yield* sql`
            INSERT INTO task_change_links (task_id, change_id)
            VALUES (1, ${internalChangeId(changeId, "BY")})
          `;
        }),
      ),
    ),
  );

const toolingFailureScopes = (root: string, validationRunId: number) =>
  withTestRepository(
    root,
    Effect.flatMap(RepositorySql, (repository) =>
      repository.operation(
        "inspect reviewer Tooling Failure scope",
        (sql) =>
          sql<{
            readonly phase: string;
            readonly producer: string;
            readonly phaseToolingFailure: string | null;
            readonly runToolingFailure: string | null;
          }>`
          SELECT result.phase, result.producer,
            result.tooling_failure AS phaseToolingFailure,
            run.run_tooling_failure AS runToolingFailure
          FROM validation_phase_results AS result
          JOIN validation_runs AS run ON run.id = result.validation_run_id
          WHERE run.id = ${validationRunId} AND result.tooling_failure IS NOT NULL
        `,
      ),
    ),
  );

const validateCandidate = (
  validation: ReturnType<typeof candidateValidationForTest>,
  input: ValidateCandidateInput,
) =>
  Effect.gen(function* () {
    const service = yield* CandidateValidation;
    return yield* service.validateCandidate(input);
  }).pipe(Effect.provide(validation.layer.pipe(Layer.provide(NodeFileSystem.layer))));

const validateAcceptanceContextCandidate = (
  validation: ReturnType<typeof candidateValidationForTest>,
  input: Parameters<CandidateValidationService["validateAcceptanceContextCandidate"]>[0],
) =>
  Effect.gen(function* () {
    const service = yield* CandidateValidation;
    return yield* service.validateAcceptanceContextCandidate(input);
  }).pipe(Effect.provide(validation.layer.pipe(Layer.provide(NodeFileSystem.layer))));

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
