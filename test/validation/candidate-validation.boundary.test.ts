import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  CandidateValidation,
  type ValidateCandidateInput,
} from "../../src/change/candidateValidation/validateCandidate.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
} from "../support/candidateReadyRepo.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTestRepository } from "../support/repository.js";

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
  );

  it.scoped("persists a Candidate-integrity Tooling Failure and preserves the Candidate", () =>
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
      if (result.ok) return;
      expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationName: "verify_candidate_head" }),
        ]),
      );
      expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
      expect(git(candidateCheckout, "status", "--porcelain")).toBe("");
      expect(git(candidateCheckout, "show", "HEAD:candidate.txt")).toBe("original");
    }),
  );

  it.scoped(
    "prepares each changed Candidate in a fresh exact-Candidate workspace before its Check",
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
        writeFileSync(join(candidateCheckout, "candidate.txt"), "first\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "first candidate");
        const first = yield* captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const prepare =
          'gitdir="$(git rev-parse --git-dir)"; printf prepared > "$gitdir/.but-why-prepared"';
        const check = 'test -f "$(git rev-parse --git-dir)/.but-why-prepared"';
        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          repository: repositoryConfig(mainCheckout),
        });
        const policy = {
          prepare: { command: prepare, timeoutSeconds: 1 },
          checks: [{ id: "prepared", command: check, timeoutSeconds: 1 }],
          copyFiles: [],
          specialistReviews: [],
        } as const;
        const firstResult = yield* validateCandidate(validation, {
          changeId: first.changeId,
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
          policy,
          now,
        });
        expect(firstResult).toMatchObject({ ok: true, outcome: "passed", reused: false });

        writeFileSync(join(candidateCheckout, "candidate.txt"), "second\n");
        git(candidateCheckout, "add", "candidate.txt");
        git(candidateCheckout, "commit", "-m", "second candidate");
        const second = yield* captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const secondResult = yield* validateCandidate(validation, {
          changeId: second.changeId,
          candidateId: second.candidateId,
          changeBaseSha: second.changeBaseSha,
          headSha: second.headSha,
          policy,
          now,
        });
        expect(secondResult).toMatchObject({ ok: true, outcome: "passed", reused: false });
        expect(secondResult).not.toMatchObject({ validationRunId: firstResult.validationRunId });

        const reused = yield* validateCandidate(validation, {
          changeId: first.changeId,
          candidateId: first.candidateId,
          changeBaseSha: first.changeBaseSha,
          headSha: first.headSha,
          policy,
          now,
        });
        expect(reused).toMatchObject({ ok: true, outcome: "passed", reused: true });

        const workspaces = yield* withTestRepository(
          mainCheckout,
          Effect.gen(function* () {
            const repository = yield* RepositorySql;
            return yield* repository.operation(
              "inspect validation workspaces",
              (sql) =>
                sql<{
                  readonly validationRunId: string;
                  readonly submittedSha: string;
                  readonly worktreePath: string;
                }>`
                SELECT validation_run_id AS validationRunId,
                  submitted_sha AS submittedSha,
                  worktree_path AS worktreePath
                FROM candidate_validation_workspace_setups
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

const repositoryConfig = (root: string) => ({
  statePath: candidateRepositoryConfig(root).statePath,
  commonDirectory: commonDirectory(root),
});
