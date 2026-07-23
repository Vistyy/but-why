import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { describe } from "vitest";

import { runCheckPhase } from "../../src/validation/runCheckRound.js";
import type { RecordCandidateValidationCheckRoundInput } from "../../src/candidateValidation/candidateValidationRunStore.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

describe("check round Findings", () => {
  it.effect("records every configured Check after failures when continuation is enabled", () =>
    Effect.gen(function* () {
      const recordedRounds: RecordCandidateValidationCheckRoundInput[] = [];
      const commands: string[] = [];
      const result = yield* runCheckPhase({
        validationRunId: "candidate-run",
        continueAfterFinding: true,
        checks: [
          { id: "first", command: "exit 1", timeoutSeconds: 1 },
          { id: "later", command: "exit 0", timeoutSeconds: 1 },
        ],
        artifactsRoot: createTestWorkspace(),
        now,
        sandbox: {
          exec: async (command) => {
            commands.push(command);
            if (command === "command -v timeout >/dev/null 2>&1") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }

            return command.includes("exit 1")
              ? { exitCode: 1, stdout: "", stderr: "\n__BUTWHY_CHECK_COMPLETED_first__:1\n" }
              : { exitCode: 0, stdout: "", stderr: "\n__BUTWHY_CHECK_COMPLETED_later__:0\n" };
          },
        },
        recordCheckRound: (input) => Effect.sync(() => void recordedRounds.push(input)),
      });

      expect(result).toEqual({ ok: true, findings: 1, validationRunId: "candidate-run" });
      expect(commands).toHaveLength(4);
      expect(recordedRounds).toHaveLength(2);
      expect(recordedRounds.map((round) => round.phaseStatus)).toEqual(["failed", "failed"]);
      expect(recordedRounds.map((round) => round.finding?.id)).toEqual([
        "candidate-run-F1",
        undefined,
      ]);
    }),
  );

  it.effect(
    "rejects tracked Candidate changes even when their path is an allowed untracked input",
    () =>
      Effect.gen(function* () {
        const commands: string[] = [];
        const exit = yield* Effect.exit(
          runCheckPhase({
            validationRunId: "candidate-run",
            checks: [{ id: "quality", command: "exit 0", timeoutSeconds: 1 }],
            artifactsRoot: createTestWorkspace(),
            expectedHeadSha: "abc123",
            allowedUntrackedFiles: [".validation-env"],
            now,
            sandbox: {
              exec: async (command) => {
                commands.push(command);
                return {
                  exitCode: 0,
                  stdout: "abc123\n M .validation-env\n",
                  stderr: "",
                };
              },
            },
            recordCheckRound: () => Effect.void,
          }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain(
            "Validation workspace no longer matches the Candidate.",
          );
        }
        expect(commands).toHaveLength(1);
      }),
  );

  it.effect("records timed-out check Findings without severity", () =>
    Effect.gen(function* () {
      const recordedRounds: RecordCandidateValidationCheckRoundInput[] = [];
      const result = yield* runCheckPhase({
        validationRunId: "by-1.v1",
        checks: [{ id: "quality", command: "sleep 10", timeoutSeconds: 1 }],
        artifactsRoot: createTestWorkspace(),
        now,
        sandbox: {
          exec: async (command) => {
            if (command === "command -v timeout >/dev/null 2>&1") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }

            return { exitCode: 124, stdout: "", stderr: "partial stderr" };
          },
        },
        recordCheckRound: (input) => Effect.sync(() => void recordedRounds.push(input)),
      });

      expect(result).toEqual({ ok: true, findings: 1, validationRunId: "by-1.v1" });
      expect(recordedRounds).toHaveLength(1);
      expect(recordedRounds[0]?.finding).toEqual({
        id: "by-1.v1-F1",
        validationRunId: "by-1.v1",
        phase: "checks",
        producer: "quality",
        title: "Check timed out: quality",
        description: "Configured check quality timed out after 1 seconds.",
        evidence: "command: sleep 10\ntimeoutSeconds: 1",
        files: [],
        artifactRefs: [
          "artifact:by-1.v1/checks/quality/stdout.txt",
          "artifact:by-1.v1/checks/quality/stderr.txt",
          "artifact:by-1.v1/checks/quality/exit-code.json",
          "artifact:by-1.v1/checks/quality/logs.txt",
        ],
      });
      expect(recordedRounds[0]?.finding).not.toHaveProperty("severity");
    }),
  );

  it.effect("treats Check IDs as literal completion-marker text", () =>
    Effect.gen(function* () {
      const recordedRounds: RecordCandidateValidationCheckRoundInput[] = [];
      const result = yield* runCheckPhase({
        validationRunId: "candidate-run",
        checks: [{ id: "[quality]", command: "true", timeoutSeconds: 1 }],
        artifactsRoot: createTestWorkspace(),
        now,
        sandbox: {
          exec: async (command) =>
            command === "command -v timeout >/dev/null 2>&1"
              ? { exitCode: 0, stdout: "", stderr: "" }
              : {
                  exitCode: 0,
                  stdout: "",
                  stderr: "\n__BUTWHY_CHECK_COMPLETED_[quality]__:0\n",
                },
        },
        recordCheckRound: (input) => Effect.sync(() => void recordedRounds.push(input)),
      });

      expect(result).toEqual({ ok: true, findings: 0 });
      expect(recordedRounds).toMatchObject([{ producer: "[quality]", roundStatus: "passed" }]);
    }),
  );
});
