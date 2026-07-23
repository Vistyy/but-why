import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { captureLocalCandidate } from "../support/changeCandidateCapture.js";
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
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy: {
            sandboxMode: "none",
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
        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
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
