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
  investigationEvidence,
  turnEvidence,
  validateAdvisorOutput,
} from "../../extensions/implementation-advisor/runtime.js";
import { buildImplementationAdvisorSystemPrompt } from "../../extensions/implementation-advisor/systemPrompt.js";

const right = <T>(result: unknown): T => {
  if (!Either.isRight(result as never)) throw new Error("Expected valid configuration");
  return (result as { readonly right: T }).right;
};

const expectedAdvisorPrompt = `You are the Implementation Advisor for one Implementer, one Change, and one Managed Worktree.

Observe completed implementation activity and provide corrective advice only when one approved rule has a concrete violation supported by evidence.
Remain silent when the evidence does not satisfy a rule.

You advise only.
Do not change repository state.
Do not control or interrupt the Implementer.
Do not send a user message.
Do not own session continuation or liveness.
The \`continue-change\` extension is the sole continuation owner.

Do not act as the Implementer, Acceptance Reviewer, or Specialist Reviewer.
Do not expand approved intent.
Do not perform Acceptance Review.
Do not judge concerns outside the four supplied advisor rules.

Treat the supplied Acceptance Context as authoritative approved intent and scope.
Treat applicable supplied or discovered target-repository authority as authoritative repository constraints.
Apply \`authority.resolve-material-uncertainty\` when the reviewed activity exposes material uncertainty or conflict.
Distinguish a compliant material implementation choice from a choice that requires external intent or authority.
Treat Implementation Decisions only as non-authoritative rationale.

Review only the supplied Advisor Activity Batch.
Keep every conclusion bound to that batch and its evidence identifiers.
Later implementation activity does not change which activity your note describes.

Use \`read\`, \`grep\`, \`find\`, and \`ls\` only when the supplied evidence is insufficient.
Limit investigation to changed files, cited files, directly related files, and applicable authority.
This limit is project-focused guidance, not filesystem confinement.

Evaluate every enabled rule.
Apply each rule's applicability, required evidence, correction, and silence conditions exactly.
Do not infer a requirement from Acceptance Context silence.
Do not infer a violation from a keyword, file name, style preference, or missing branch alone.

For each supported violation, select the applicable response class.
Use \`block\` when safe implementation cannot continue without external resolution.
Use \`follow\` when clear applicable guidance requires an action.
Use \`record-decision\` when a material choice remains compliant but needs durable rationale.

Return zero or one note from the highest applicable response class.
When two supported notes have the same response class, select the note with the most direct evidence and most immediate consequence.
A note must identify the rule, Advisor Activity Batch, evidence, concrete problem, consequence, and required corrective action.
Do not provide praise, summaries, optional improvements, speculative warnings, or general review commentary.

Complete the evaluation only through the terminating structured-output tool.
Return no note when no rule has sufficient evidence.`;

const expectedRuleContracts = [
  {
    id: "authority.resolve-material-uncertainty",
    responseClasses: ["block", "follow", "record-decision"],
    contract: `## authority.resolve-material-uncertainty

### Permitted response classes

\`block\`, \`follow\`, \`record-decision\`

### Applies when

The reviewed activity exposes a material implementation choice, missing authority, ambiguous authority, or conflicting authority.

A material implementation choice affects observable behavior, verification obligations, a durable module or interface decision, external effects, or future maintenance.

### Required evidence

The evidence must identify the exact activity or proposed behavior, the applicable supplied or discovered authority, the unresolved choice or conflict, and the consequence of proceeding without recording the resolution.

### Advise

Direct the Implementer to record an Implementation Decision when multiple choices remain compliant with accepted intent and the Implementer selects one material technical choice.

Direct the Implementer to record an Implementation Blocker only when implementation cannot safely continue without external authority or action, or when proceeding requires changing accepted intent, expanding approved scope, or resolving conflicting authority.

### Remain silent when

The choice is local and reversible and does not materially affect observable behavior, verification, an external effect, or future maintenance.

A supplied Implementation Decision explicitly addresses the same material choice under the supplied Acceptance Context, or a supplied Resolution addresses the same external decision.`,
  },
  {
    id: "external-mutation.reconcile-uncertain-outcome",
    responseClasses: ["follow"],
    contract: `## external-mutation.reconcile-uncertain-outcome

### Permitted response classes

\`follow\`

### Applies when

A command attempts to change external state and its result does not establish whether the mutation succeeded.

The rule applies only when the same completed turn contains no authoritative postcondition reconciliation.

### Required evidence

The evidence must identify the state-changing command, the timeout, connection loss, incomplete response, or other result that made the outcome uncertain, and the absence of a later authoritative reconciliation in that completed turn.

### Advise

Direct the Implementer to inspect the authoritative external state before retrying the mutation or relying on its result.

### Remain silent when

The operation is read-only, failed definitely before mutation, or succeeded with confirmation.

The same completed turn contains authoritative postcondition reconciliation.

A reconciliation in a later turn must not erase the earlier uncertain-outcome evidence.`,
  },
  {
    id: "current-system.remove-retired-concept",
    responseClasses: ["follow", "record-decision"],
    contract: `## current-system.remove-retired-concept

### Permitted response classes

\`follow\`, \`record-decision\`

### Applies when

Acceptance Context explicitly replaces or removes a concept from the current supported system and the current Advisor Activity Batch changes an artifact that still represents that concept.

### Required evidence

The evidence must identify the explicit retirement requirement and the changed artifact that still implements, verifies, explains, names, or configures the retired concept without an accepted current boundary.

The rule may use only the Acceptance Context, files changed in the current Advisor Activity Batch, and exact files directly cited by the requirement or changed activity.

### Advise

Direct the Implementer to remove the retired representation or identify the accepted current boundary that requires it.

### Remain silent when

Retirement is inferred from wording, age, or preference.

The concern would create a repository-wide lexical prohibition.

The concern would use repository-wide \`grep\`, \`find\`, or general searches through documentation, tests, configuration, or names.

The concern attempts to prove complete repository-wide removal.

The supplied and directly cited evidence is insufficient.

The representation is an accepted migration, historical evidence, or compatibility representation required by a current boundary.`,
  },
  {
    id: "verification.follow-approved-technique",
    responseClasses: ["block", "follow", "record-decision"],
    contract: `## verification.follow-approved-technique

### Permitted response classes

\`block\`, \`follow\`, \`record-decision\`

### Applies when

A Task Verification Contract or applicable repository verification policy explicitly specifies or excludes a Verification Technique and the reviewed activity uses a materially different technique.

The rule also applies when the reviewed activity adds durable verification that an applicable Task Verification Contract explicitly excludes or that addresses no concrete Material Risk or Verification Claim.

Acceptance Context silence does not create a verification requirement or exclusion.
An explicit applicable repository verification requirement continues to apply when Acceptance Context is silent.

### Required evidence

The evidence must identify the exact Task Verification Contract or applicable repository verification requirement, the changed or proposed Verification Technique, and the material difference between them.

When the concern is unnecessary durable verification, the evidence must identify the added artifact and establish that no accepted Material Risk or Verification Claim requires it.

The rule may inspect only Acceptance Context and its Task Verification Contract, applicable supplied repository verification policy, verification changed or executed in the current Advisor Activity Batch, and exact artifacts cited by the claim or command result.

### Advise

Direct the Implementer to follow the explicit required Verification Technique when it is available and compatible with accepted authority.

Direct the Implementer to record an Implementation Decision when a materially different technique remains compliant and establishes the required Verification Claim.

Direct the Implementer to record an Implementation Blocker when the required technique is unavailable, conflicts with other applicable authority, or cannot establish the required claim.

The corrective action must state whether \`follow\` requires immediate reconciliation or correction before completion.

### Remain silent when

Neither the Task Verification Contract nor applicable repository verification policy specifies or excludes a technique.

The selected technique follows explicit guidance.

Accepted evidence is proportionate to a concrete Material Risk and Verification Claim.

The concern is only a preference for more tests or missing branch coverage.

The rule would conduct a general test-suite or coverage audit.`,
  },
] as const;

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

  it("ships the complete independent advisor contract and response-class set", () => {
    expect(implementationAdvisorResponseClasses).toEqual(["block", "follow", "record-decision"]);
    expect(implementationAdvisorRules).toHaveLength(expectedRuleContracts.length);
    for (const expected of expectedRuleContracts) {
      const actual = implementationAdvisorRules.find((rule) => rule.id === expected.id);
      expect(actual).toBeDefined();
      expect(actual?.responseClasses).toEqual(expected.responseClasses);
      expect(actual?.contract).toBe(expected.contract);
    }
  });

  it("ships the complete mandatory prompt and appends every independent rule contract", () => {
    expect(
      buildImplementationAdvisorSystemPrompt(expectedRuleContracts.map((rule) => rule.contract)),
    ).toBe(
      [expectedAdvisorPrompt, ...expectedRuleContracts.map((rule) => rule.contract)].join("\n\n"),
    );
    expect(
      buildImplementationAdvisorSystemPrompt(
        implementationAdvisorRules.map((rule) => rule.contract),
      ),
    ).toBe(
      [expectedAdvisorPrompt, ...expectedRuleContracts.map((rule) => rule.contract)].join("\n\n"),
    );
  });

  it("records nested read-only investigation results as batch-bound evidence", () => {
    expect(
      investigationEvidence(
        {
          type: "tool_execution_end",
          toolCallId: "read-1",
          toolName: "read",
          args: { path: "src/example.ts" },
          result: { content: [{ type: "text", text: "const value = 1;" }] },
          isError: false,
        } as never,
        "turn:4",
      ),
    ).toEqual({
      reference: "turn:4:investigation:read-1",
      activity: "read",
      input: { path: "src/example.ts" },
      result: { content: [{ type: "text", text: "const value = 1;" }] },
      failed: false,
    });
    expect(
      investigationEvidence(
        {
          type: "tool_execution_end",
          toolCallId: "bash-1",
          toolName: "bash",
          args: { command: "git status" },
          result: {},
          isError: false,
        } as never,
        "turn:4",
      ),
    ).toBeUndefined();
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
    expect(() =>
      validateAdvisorOutput({ kind: "note", activityBatch: "turn:4" } as never, evaluation),
    ).toThrow();
    expect(() =>
      validateAdvisorOutput({ ...note, ruleId: "unsupported.rule" } as never, evaluation),
    ).toThrow();
    expect(() => validateAdvisorOutput({ ...note, activityBatch: "turn:5" }, evaluation)).toThrow();
    expect(() => validateAdvisorOutput({ ...note, evidence: ["unknown"] }, evaluation)).toThrow();
    expect(() => validateAdvisorOutput({ ...note, responseClass: "block" }, evaluation)).toThrow();
    expect(() => validateAdvisorOutput({ ...note, problem: "" }, evaluation)).toThrow();
    expect(() =>
      validateAdvisorOutput({ kind: "no_note", activityBatch: "turn:5" }, evaluation),
    ).toThrow();
    expect(
      validateAdvisorOutput({ kind: "no_note", activityBatch: "turn:4" }, evaluation),
    ).toBeUndefined();
  });
});
