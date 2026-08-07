import { describe, expect, it } from "vitest";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "../../src/sqlite/sqliteAcceptanceContextSnapshot.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "../../src/sqlite/sqliteChangePreparation.js";
import {
  decodeSqliteCandidateValidationPolicy,
  decodeSqliteImplementationDecisions,
} from "../../src/sqlite/sqlitePersistenceDecoders.js";

describe("SQLite persisted structured decoders", () => {
  it("round-trips Acceptance Context Snapshots and preparation failures", () => {
    const context = {
      version: 1 as const,
      title: "Title",
      description: "Description",
      comments: ["comment"],
      resolutions: ["resolution"],
    };
    const failure = {
      command: "pnpm test",
      exitCode: 1,
      timedOut: false,
      stdout: "out",
      stderr: "err",
    };

    expect(
      decodeSqliteAcceptanceContextSnapshot(encodeSqliteAcceptanceContextSnapshot(context)),
    ).toEqual(context);
    expect(decodeSqliteChangePrepareFailure(encodeSqliteChangePrepareFailure(failure))).toEqual(
      failure,
    );
  });

  it.each([
    [
      "Acceptance Context resolutions",
      JSON.stringify({ version: 1, title: "t", description: "d", comments: [], resolutions: [1] }),
    ],
    ["Candidate Validation Policy checks", JSON.stringify({ checks: [{}], copyFiles: [] })],
    ["Implementation Decisions", JSON.stringify([{ id: "decision" }])],
    [
      "Change preparation failure",
      JSON.stringify({ command: "command", exitCode: 1, timedOut: false }),
    ],
  ])("rejects malformed %s", (description, value) => {
    const decode =
      description === "Acceptance Context resolutions"
        ? () => decodeSqliteAcceptanceContextSnapshot(value)
        : description === "Candidate Validation Policy checks"
          ? () => decodeSqliteCandidateValidationPolicy(value)
          : description === "Implementation Decisions"
            ? () => decodeSqliteImplementationDecisions(value)
            : () => decodeSqliteChangePrepareFailure(value);
    expect(decode).toThrow();
  });
});
