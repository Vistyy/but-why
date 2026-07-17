import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { runCheckPhase } from "../src/validation/runCheckRound.js";
import type { RecordValidationRunCheckRoundInput } from "../src/validationRun/validationRunStore.js";
import { cleanupTempRoots, createTempRoot } from "./support/by-cli.js";

const now = "2026-06-30T12:00:00.000Z";

afterEach(cleanupTempRoots);

describe("check round Findings", () => {
  it("records timed-out check Findings without severity", async () => {
    const recordedRounds: RecordValidationRunCheckRoundInput[] = [];
    const result = await Effect.runPromise(
      runCheckPhase({
        validationRunId: "by-1.v1",
        checks: [{ id: "quality", command: "sleep 10", timeoutSeconds: 1 }],
        artifactsRoot: createTempRoot(),
        now,
        sandbox: {
          exec: async (command) => {
            if (command === "command -v timeout >/dev/null 2>&1") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }

            return { exitCode: 124, stdout: "", stderr: "partial stderr" };
          },
        },
        recordCheckRound: (input) => recordedRounds.push(input),
      }),
    );

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
  });
});
