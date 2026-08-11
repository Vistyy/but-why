import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { describe } from "vitest";
import type { RecordCandidateValidationCheckRoundInput } from "../../src/change/candidateValidation/candidateValidationRunStore.js";
import { runCheckPhase } from "../../src/change/validation/runCheckRound.js";
import { WorkspaceCommandExecutionFailed } from "../../src/command/workspaceCommand.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

it.layer(NodeFileSystem.layer)((it) => {
  describe("check round Findings", () => {
    it.effect(
      "fails as Validation Tooling Failure when the timeout utility is unavailable before the Check starts",
      () =>
        Effect.gen(function* () {
          const workspace = createTestWorkspace();
          const marker = join(workspace, "check-started");
          const shPath = runTestProcessOrThrow("sh", ["-c", "command -v sh"], { cwd: workspace });
          // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
          const restrictedPath = (process.env["PATH"] ?? "")
            .split(delimiter)
            .filter((entry) => entry !== "" && !existsSync(join(entry, "timeout")))
            .join(delimiter);

          expect(
            runTestProcess(shPath, ["-c", "command -v timeout"], {
              cwd: workspace,
              env: { PATH: restrictedPath },
            }).status,
          ).not.toBe(0);
          expect(
            runTestProcess(shPath, ["-c", "printf ok"], {
              cwd: workspace,
              env: { PATH: restrictedPath },
            }).status,
          ).toBe(0);

          const exit = yield* Effect.exit(
            runCheckPhase({
              validationRunId: "candidate-run",
              checks: [
                { id: "quality", command: `printf started > '${marker}'`, timeoutSeconds: 1 },
              ],
              artifactsRoot: createTestWorkspace(),
              now,
              commandExecutor: (command, options) =>
                Effect.sync(() => {
                  const result = runTestProcess(shPath, ["-c", command], {
                    cwd: options?.cwd ?? workspace,
                    env: { PATH: restrictedPath },
                  });
                  return {
                    exitCode: result.status ?? 0,
                    stdout: result.stdout,
                    stderr: result.stderr,
                  };
                }),
              recordCheckRound: () => Effect.void,
            }),
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.pretty(exit.cause)).toContain(
              "Could not find timeout command for check quality.",
            );
          }
          expect(existsSync(marker)).toBe(false);
        }),
    );

    it.effect("translates expected command infrastructure failures", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runCheckPhase({
            validationRunId: "candidate-run",
            checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
            artifactsRoot: createTestWorkspace(),
            now,
            commandExecutor: () =>
              Effect.fail(new WorkspaceCommandExecutionFailed({ message: "executor unavailable" })),
            recordCheckRound: () => Effect.void,
          }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        expect(Cause.failureOption(exit.cause)).toMatchObject({
          value: { _tag: "CheckCommandExecutionToolingFailed", message: "executor unavailable" },
        });
      }),
    );

    it.effect("preserves unexpected command executor defects", () =>
      Effect.gen(function* () {
        const defect = new Error("unexpected executor defect");
        const exit = yield* Effect.exit(
          runCheckPhase({
            validationRunId: "candidate-run",
            checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
            artifactsRoot: createTestWorkspace(),
            now,
            commandExecutor: () => Effect.die(defect),
            recordCheckRound: () => Effect.void,
          }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        expect(Cause.failureOption(exit.cause)).toEqual(Option.none());
        expect(Cause.dieOption(exit.cause)).toEqual(Option.some(defect));
      }),
    );

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
          commandExecutor: (command) =>
            Effect.sync(() => {
              commands.push(command);
              if (command === "command -v timeout >/dev/null 2>&1") {
                return { exitCode: 0, stdout: "", stderr: "" };
              }

              return command.includes("exit 1")
                ? { exitCode: 1, stdout: "", stderr: "\n__BUTWHY_CHECK_COMPLETED_first__:1\n" }
                : {
                    exitCode: 0,
                    stdout: "",
                    stderr: "\n__BUTWHY_CHECK_COMPLETED_later__:0\n",
                  };
            }),
          recordCheckRound: (input) => Effect.sync(() => void recordedRounds.push(input)),
        });

        expect(result).toEqual({ ok: true, findings: 1, validationRunId: "candidate-run" });
        expect(commands).toHaveLength(4);
        expect(recordedRounds).toHaveLength(2);
        expect(recordedRounds.map((round) => round.roundStatus)).toEqual(["failed", "passed"]);
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
              commandExecutor: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return {
                    exitCode: 0,
                    stdout: "abc123\n M .validation-env\n",
                    stderr: "",
                  };
                }),
              recordCheckRound: () => Effect.void,
            }),
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.pretty(exit.cause)).toContain(
              "Snapshot Workspace no longer matches the Candidate.",
            );
          }
          expect(commands).toHaveLength(1);
        }),
    );

    it.effect("records timed-out check Findings and execution evidence", () =>
      Effect.gen(function* () {
        const recordedRounds: RecordCandidateValidationCheckRoundInput[] = [];
        const artifactsRoot = createTestWorkspace();
        const result = yield* runCheckPhase({
          validationRunId: "by-1.v1",
          checks: [{ id: "quality", command: "sleep 10", timeoutSeconds: 1 }],
          artifactsRoot,
          now,
          commandExecutor: (command) =>
            Effect.succeed(
              command === "command -v timeout >/dev/null 2>&1"
                ? { exitCode: 0, stdout: "", stderr: "" }
                : { exitCode: 124, stdout: "", stderr: "partial stderr" },
            ),
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
            "artifact:by-1.v1/checks/quality/execution.json",
          ],
        });
        const execution = recordedRounds[0]?.artifactRecords.find(
          (artifact) => artifact.path === "by-1.v1/checks/quality/execution.json",
        );
        expect(execution).toBeDefined();
        expect(
          JSON.parse(readFileSync(join(artifactsRoot, execution?.path ?? ""), "utf8")),
        ).toEqual({
          durationMs: expect.any(Number),
        });
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
          commandExecutor: (command) =>
            Effect.succeed(
              command === "command -v timeout >/dev/null 2>&1"
                ? { exitCode: 0, stdout: "", stderr: "" }
                : {
                    exitCode: 0,
                    stdout: "",
                    stderr: "\n__BUTWHY_CHECK_COMPLETED_[quality]__:0\n",
                  },
            ),
          recordCheckRound: (input) => Effect.sync(() => void recordedRounds.push(input)),
        });

        expect(result).toEqual({ ok: true, findings: 0 });
        expect(recordedRounds).toMatchObject([{ producer: "[quality]", roundStatus: "passed" }]);
      }),
    );
  });
});
