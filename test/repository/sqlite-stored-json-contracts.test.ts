import { describe, expect, it } from "vitest";

import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "../../src/sqlite/sqliteAcceptanceContextSnapshot.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "../../src/sqlite/sqliteChangePreparation.js";

describe("SQLite stored JSON contracts", () => {
  it("round-trips Acceptance Context Snapshots and rejects unknown fields", () => {
    const snapshot = {
      version: 1,
      title: "Accepted Task",
      description: "Implement the accepted behavior.",
      comments: ["Keep this constraint."],
      resolutions: ["Use the approved resolution."],
    } as const;

    expect(
      decodeSqliteAcceptanceContextSnapshot(encodeSqliteAcceptanceContextSnapshot(snapshot)),
    ).toEqual(snapshot);
    expect(() =>
      decodeSqliteAcceptanceContextSnapshot(
        '{"version":1,"title":"Accepted Task","description":"Accepted.","extra":true}',
      ),
    ).toThrow();
  });

  it("round-trips Change preparation failures and strips unknown fields", () => {
    const failure = {
      command: "just init",
      exitCode: 1,
      timedOut: false,
      stdout: "output",
      stderr: "failure",
    } as const;

    expect(decodeSqliteChangePrepareFailure(encodeSqliteChangePrepareFailure(failure))).toEqual(
      failure,
    );
    expect(
      decodeSqliteChangePrepareFailure(
        '{"command":"just init","exitCode":1,"timedOut":false,"stdout":"output","stderr":"failure","extra":true}',
      ),
    ).toEqual(failure);
  });

  it.each([
    ["Acceptance Context field", '{"version":1,"title":1,"description":"Accepted."}'],
    [
      "Change preparation field",
      '{"command":"just init","exitCode":1.5,"timedOut":false,"stdout":"","stderr":""}',
    ],
  ])("rejects malformed stored JSON: %s", (contract, encoded) => {
    const decode = contract.startsWith("Acceptance")
      ? decodeSqliteAcceptanceContextSnapshot
      : decodeSqliteChangePrepareFailure;

    expect(() => decode(encoded)).toThrow();
  });
});
