import { describe, expect, it } from "vitest";

import {
  containsVisibleChangeSubmit,
  countVisibleChangeSubmits,
  decideContinuation,
  extractChangeId,
  nextRetryState,
} from "../../extensions/continue-change.js";

describe("Change Implement continuation policy", () => {
  it("classifies an unfinished Change with Findings", () => {
    expect(
      decideContinuation({
        change: { state: "open", closeReason: null, acceptanceContext: null },
        currentCandidate: null,
        currentValidationRun: null,
        findingCount: 2,
        toolingFailureCount: 0,
        pullRequest: null,
      }),
    ).toEqual({ kind: "findings" });
  });

  it.each([
    [
      "closed Change",
      { change: { state: "closed", closeReason: "completed", acceptanceContext: null } } as const,
    ],
    [
      "tooling failure",
      {
        change: { state: "open", closeReason: null, acceptanceContext: null },
        toolingFailureCount: 1,
      } as const,
    ],
  ])("permits idle state for a %s", (_name, input) => {
    expect(
      decideContinuation({
        currentCandidate: null,
        currentValidationRun: null,
        findingCount: 0,
        toolingFailureCount: 0,
        pullRequest: null,
        ...input,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("permits idle state for an owned pull request matching the current Candidate and Git head", () => {
    expect(
      decideContinuation(
        {
          change: { state: "open", closeReason: null, acceptanceContext: null },
          currentCandidate: { id: "candidate-1", headSha: "head-1" },
          currentValidationRun: null,
          findingCount: 0,
          toolingFailureCount: 0,
          pullRequest: { number: 4 },
          publication: {
            candidateId: "candidate-1",
            expectedHeadSha: "head-1",
            pullRequest: { number: 4 },
          },
        },
        { head: "head-1", status: "" },
      ),
    ).toEqual({ kind: "idle" });
  });

  it("continues when a pull request does not match the current Git head", () => {
    expect(
      decideContinuation(
        {
          change: { state: "open", closeReason: null, acceptanceContext: null },
          currentCandidate: { id: "candidate-1", headSha: "old-head" },
          currentValidationRun: null,
          findingCount: 0,
          toolingFailureCount: 0,
          pullRequest: { number: 4 },
          publication: {
            candidateId: "candidate-1",
            expectedHeadSha: "old-head",
            pullRequest: { number: 4 },
          },
        },
        { head: "new-head", status: "" },
      ),
    ).toEqual({ kind: "general" });
  });

  it.each([
    "just by change submit change-123",
    "pnpx but-why change submit change-123",
    "npx -y but-why change submit change-123",
    "git status && just by change submit change-123",
    "git status\n npx -y but-why change submit change-123",
    "{ just by change submit change-123; }",
    "if true; then just by change submit change-123; fi",
    `printf '%s\\n' "$(just by change submit change-123)"`,
    "echo `just by change submit change-123`",
    `printf '%s\\n' "\`just by change submit change-123\`"`,
    "printf '<<DATA'; just by change submit change-123",
    "commands=($(just by change submit change-123))",
    "commands=(<(just by change submit change-123))",
    "commands=(>(just by change submit change-123))",
    "cat <<END-MARKER\ntext\nEND-MARKER\njust by change submit change-123",
    "echo $((1 << 2))\njust by change submit change-123",
    "(( value = 1 << 2 ))\njust by change submit change-123",
    "value=$((\n  1 << 2\n))\njust by change submit change-123",
    "commands=(foo\\()\njust by change submit change-123",
    'output="$(\n  echo ready # )\n  just by change submit change-123\n)"',
  ])("detects a visible canonical Change Submit in %j", (command) => {
    expect(containsVisibleChangeSubmit(command)).toBe(true);
  });

  it.each([
    "git status",
    "just by change show change-123",
    "just by change submit --help",
    "just by change submit -h",
    "just by change submit --version",
    "just by change submit --completions bash",
    "npx -y but-why change submit change-123 --help",
    'printf "just by change submit change-123"',
    "printf 'line one\\njust by change submit change-123\\n'",
    "printf 'line one\njust by change submit change-123\n'",
    'submit="just by change submit change-123"',
    "# just by change submit change-123\ngit status",
    "commands=(just by change submit change-123)",
    "commands=(npx -y but-why change submit change-123)",
    "commands=(pnpx but-why change submit change-123)",
    "commands=(\n  just by change submit change-123\n)",
    "commands=(\n  # Keep ) in this comment\n  just by change submit change-123\n)",
    "commands=(\n  foo\\)\n  just by change submit change-123\n)",
    "cat <<'DATA'\njust by change submit change-123\nDATA",
    "cat <<\\EOF\njust by change submit change-123\nEOF",
    "./submit-change.sh",
  ])("does not classify unrelated Bash command %j as Change Submit", (command) => {
    expect(containsVisibleChangeSubmit(command)).toBe(false);
  });

  it("counts every directly visible Change Submit invocation", () => {
    expect(
      countVisibleChangeSubmits(
        "just by change submit change-123; npx -y but-why change submit change-123",
      ),
    ).toBe(2);
  });

  it("extracts the Change identity from the implementer prompt", () => {
    expect(extractChangeId("Change identity: BY-C42.")).toBe("BY-C42");
    expect(
      extractChangeId("Change identity: de32d32a-ecd8-46b4-b2d8-5a08d2128869."),
    ).toBeUndefined();
    expect(extractChangeId("The assistant said Change identity: not-a-change.")).toBeUndefined();
  });

  it("resets the unchanged restart count when the durable fingerprint changes", () => {
    expect(nextRetryState({ fingerprint: "old", unchangedRestarts: 2 }, "new")).toEqual({
      fingerprint: "new",
      unchangedRestarts: 0,
    });
    expect(nextRetryState({ fingerprint: "same", unchangedRestarts: 2 }, "same")).toEqual({
      fingerprint: "same",
      unchangedRestarts: 3,
    });
  });
});
