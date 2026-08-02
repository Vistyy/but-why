export const implementationAdvisorResponseClasses = [
  "block",
  "follow",
  "record-decision",
] as const;

export type ImplementationAdvisorResponseClass =
  (typeof implementationAdvisorResponseClasses)[number];

export const implementationAdvisorRules = [
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

export type ImplementationAdvisorRuleId = (typeof implementationAdvisorRules)[number]["id"];

export const implementationAdvisorRuleIds = new Set<string>(
  implementationAdvisorRules.map((rule) => rule.id),
);
