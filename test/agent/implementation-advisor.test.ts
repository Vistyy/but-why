import { resolve } from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeGlobalConfig, type GlobalConfig } from "../../src/contracts/globalConfig.js";
import { decodeRepoConfig, type RepoConfig } from "../../src/contracts/repoConfig.js";
import { resolveImplementationAdvisor } from "../../src/change/implementationAdvisorConfig.js";
import {
  implementationAdvisorRules,
  implementationAdvisorResponseClasses,
} from "../../extensions/implementation-advisor/rules.js";
import {
  implementationAdvisorOutputSchema,
  turnEvidence,
  validateAdvisorOutput,
} from "../../extensions/implementation-advisor/runtime.js";
import { buildImplementationAdvisorSystemPrompt } from "../../extensions/implementation-advisor/systemPrompt.js";

const right = <T>(result: unknown): T => {
  if (!Either.isRight(result as never)) throw new Error("Expected valid configuration");
  return (result as { readonly right: T }).right;
};

describe("Implementation Advisor", () => {
  it("resolves explicit Repo Config false atomically over Global Config", () => {
    const global = right<GlobalConfig>(
      decodeGlobalConfig({
        interactiveSession: { implementationAdvisor: { model: "provider/global" } },
      }),
    );
    const repo = right<RepoConfig>(
      decodeRepoConfig({ taskPrefix: "BY", interactiveSession: { implementationAdvisor: false } }),
    );
    expect(resolveImplementationAdvisor({ repoConfig: repo, globalConfig: global })).toBe(false);
  });

  it("contains the four complete typed operational contracts", () => {
    expect(implementationAdvisorRules.map((rule) => rule.id)).toEqual([
      "authority.resolve-material-uncertainty",
      "external-mutation.reconcile-uncertain-outcome",
      "current-system.remove-retired-concept",
      "verification.follow-approved-technique",
    ]);
    for (const rule of implementationAdvisorRules) {
      expect(rule.contract).toContain("### Applies when");
      expect(rule.contract).toContain("### Required evidence");
      expect(rule.contract).toContain("### Advise");
      expect(rule.contract).toContain("### Remain silent when");
      expect(rule.responseClasses.length).toBeGreaterThan(0);
    }
    expect(implementationAdvisorResponseClasses).toEqual(["block", "follow", "record-decision"]);
  });

  it("builds the mandatory prompt from every complete rule contract", () => {
    const prompt = buildImplementationAdvisorSystemPrompt(
      implementationAdvisorRules.map((rule) => rule.contract),
    );
    expect(prompt).toContain("The `continue-change` extension is the sole continuation owner.");
    expect(prompt).toContain(
      "Complete the evaluation only through the terminating structured-output tool.",
    );
    for (const rule of implementationAdvisorRules) expect(prompt).toContain(rule.contract);
  });

  it("qualifies edits, commands, failures, and explicitly identified authority reads only", () => {
    const event = {
      turnIndex: 4,
      toolResults: [
        {
          toolName: "read",
          toolCallId: "ordinary",
          input: { path: "README.md" },
          content: [],
          isError: false,
        },
        {
          toolName: "read",
          toolCallId: "authority",
          input: { path: "AGENTS.md" },
          content: [],
          isError: false,
        },
        {
          toolName: "bash",
          toolCallId: "command",
          input: { command: "git status" },
          content: [],
          isError: false,
        },
        { toolName: "ls", toolCallId: "failed", input: {}, content: [], isError: true },
      ],
    } as never;
    expect(
      turnEvidence(event, new Set([resolve(process.cwd(), "AGENTS.md")]), process.cwd()).map(
        (item) => item.reference,
      ),
    ).toEqual([
      "turn:4:evidence:1:authority",
      "turn:4:evidence:2:command",
      "turn:4:evidence:3:failed",
    ]);
  });

  it("validates exact batches, rule response classes, and evidence identity", () => {
    const evaluation = {
      activityBatch: "turn:4",
      evidence: [
        {
          reference: "turn:4:evidence:0:write",
          activity: "write",
          input: {},
          result: [],
          failed: false,
        },
      ],
      acceptanceContext: null,
      implementationDecisions: [],
    } as const;
    const note = {
      kind: "note" as const,
      ruleId: "external-mutation.reconcile-uncertain-outcome",
      responseClass: "follow",
      activityBatch: "turn:4",
      evidence: ["turn:4:evidence:0:write"],
      problem: "The outcome is uncertain.",
      consequence: "A retry can duplicate the mutation.",
      correction: "Reconcile the authoritative state before retrying.",
    };
    expect(Value.Check(implementationAdvisorOutputSchema, note)).toBe(true);
    expect(validateAdvisorOutput(note, evaluation)).toMatchObject({ activityBatch: "turn:4" });
    expect(() => validateAdvisorOutput({ ...note, activityBatch: "turn:5" }, evaluation)).toThrow();
    expect(() => validateAdvisorOutput({ ...note, evidence: ["unknown"] }, evaluation)).toThrow();
    expect(() => validateAdvisorOutput({ ...note, responseClass: "block" }, evaluation)).toThrow();
    expect(
      validateAdvisorOutput({ kind: "no_note", activityBatch: "turn:4" }, evaluation),
    ).toBeUndefined();
  });
});
