import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { RecordCandidateValidationPrepareResultInput } from "../../src/change/candidateValidation/candidateValidationRunStore.js";
import { runPreparePhase as runPreparePhaseWithFileSystem } from "../../src/change/validation/runPreparePhase.js";
import { WorkspaceCommandExecutionFailed } from "../../src/command/workspaceCommand.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const runPreparePhase = (input: Parameters<typeof runPreparePhaseWithFileSystem>[0]) =>
  runPreparePhaseWithFileSystem(input).pipe(Effect.provide(NodeFileSystem.layer));

describe("Prepare Phase Results", () => {
  it.effect("records a nonzero Prepare command as a Finding", () =>
    Effect.gen(function* () {
      const recordedResults: RecordCandidateValidationPrepareResultInput[] = [];
      const result = yield* runPreparePhase({
        validationRunId: 21,
        prepare: { command: "exit 7", timeoutSeconds: 10 },
        artifactsRoot: createTestWorkspace(),
        commandExecutor: (command) =>
          Effect.succeed(
            command === "command -v timeout >/dev/null 2>&1"
              ? { exitCode: 0, stdout: "", stderr: "" }
              : {
                  exitCode: 7,
                  stdout: "partial stdout",
                  stderr: "\n__BUTWHY_PREPARE_COMPLETED_prepare__:7\n",
                },
          ),
        recordPrepareResult: (input) => Effect.sync(() => void recordedResults.push(input)),
      });

      expect(result).toEqual({ outcome: "blocked" });
      expect(recordedResults).toMatchObject([
        {
          outcome: "failed",
          finding: {
            phase: "prepare",
            producer: "prepare",
            title: "Prepare failed",
            evidence: "command: exit 7\nexitCode: 7",
          },
        },
      ]);
    }),
  );

  it.effect("records a timed-out Prepare command as a Finding with execution evidence", () =>
    Effect.gen(function* () {
      const recordedResults: RecordCandidateValidationPrepareResultInput[] = [];
      const artifactsRoot = createTestWorkspace();
      const result = yield* runPreparePhase({
        validationRunId: 22,
        prepare: { command: "sleep 30", timeoutSeconds: 1 },
        artifactsRoot,
        commandExecutor: (command) =>
          Effect.succeed(
            command === "command -v timeout >/dev/null 2>&1"
              ? { exitCode: 0, stdout: "", stderr: "" }
              : { exitCode: 124, stdout: "", stderr: "partial stderr" },
          ),
        recordPrepareResult: (input) => Effect.sync(() => void recordedResults.push(input)),
      });

      expect(result).toEqual({ outcome: "blocked" });
      expect(recordedResults[0]?.finding).toMatchObject({
        title: "Prepare timed out",
        description: "Prepare command timed out after 1 seconds.",
        evidence: "command: sleep 30\ntimeoutSeconds: 1",
      });
      const execution = recordedResults[0]?.artifactRecords.find(
        (artifact) => artifact.path === "22/prepare/prepare/execution.json",
      );
      expect(execution).toBeDefined();
      expect(JSON.parse(readFileSync(join(artifactsRoot, execution?.path ?? ""), "utf8"))).toEqual({
        durationMs: expect.any(Number),
      });
    }),
  );

  it.effect("persists Prepare command execution failure on the phase result", () =>
    Effect.gen(function* () {
      const recordedResults: RecordCandidateValidationPrepareResultInput[] = [];
      const result = yield* runPreparePhase({
        validationRunId: 23,
        prepare: { command: "true", timeoutSeconds: 10 },
        artifactsRoot: createTestWorkspace(),
        commandExecutor: () =>
          Effect.fail(new WorkspaceCommandExecutionFailed({ message: "executor unavailable" })),
        recordPrepareResult: (input) => Effect.sync(() => void recordedResults.push(input)),
      });

      expect(result).toEqual({ outcome: "tooling_failed" });
      expect(recordedResults).toMatchObject([
        {
          validationRunId: 23,
          outcome: "failed",
          artifactRecords: [],
          toolingFailure: {
            validationRunId: 23,
            operationName: "run_prepare_command",
            errorMessage: expect.stringContaining("executor unavailable"),
          },
        },
      ]);
    }),
  );
});
