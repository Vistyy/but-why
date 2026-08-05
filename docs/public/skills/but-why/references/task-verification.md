# Task verification

Use this reference to design or revise a Task Verification Contract.
The contract defines the confidence required for one implementation Task without prescribing implementation techniques by default.
Do not require tests by default.

## Terms

**Material Risk** is a plausible way implementation can fail accepted intent with a meaningful consequence, supported by accepted requirements or concrete target-repository evidence.

**Verification Claim** is one specific fact that evidence must establish to address one Material Risk.
A Claim is not a list of scenarios or an evidence mechanism.

**Verification Evidence** is an interpretable observation or artifact that supports or refutes one Verification Claim.

**Task Verification Contract** is the Task Context section that records Material Risks, required Verification Claims and Evidence, escalation conditions, and explicit exclusions.
It is preserved in Acceptance Context when the Task starts.

## 1. Define required confidence

Identify each Material Risk introduced or affected by the Task.
Do not use numerical risk scoring.
Do not invent unsupported requirements or speculative edge cases.
For each Material Risk, define the smallest sufficient set of Verification Claims.
Make each Claim one fact rather than a list of accepted-behavior cases, test scenarios, or mechanisms.
A Claim must not require a stronger product guarantee than accepted intent justifies.
Do not add product behavior only to make verification easier.

This step is complete when every Material Risk has sufficient Claims and every Claim addresses one Material Risk.

## 2. Select proportionate evidence

For each Verification Claim, select the least costly evidence that can establish it reliably.
Use evidence that observes the complete Claim.
Use integration or end-to-end evidence only when interaction between system parts is part of the Claim.
Treat existing tests and checks as evidence inventory, not as authority for the required technique.
Do not use test count, coverage percentage, file category, or integration level as a substitute for a Claim.

Evidence can include type checking, static analysis, focused commands, tests, inspection, rendered behavior, logs, traces, reproducible procedures, measurements, experiments, and mandatory repository gates.
These examples do not limit the available techniques.
Require durable automated evidence only when maintained automation protects accepted behavior or an invariant against a plausible regression that existing or one-time evidence would not address sufficiently, and that protection justifies its authoring, execution, and maintenance cost.
Do not translate each accepted-behavior statement or evidence example into a test.
Do not use a numerical score or test-to-production line ratio to justify durable automation.

Specify a mechanism only when it is necessary to observe an interaction that is part of the Claim.
An Implementer may use another mechanism that establishes the same Claim, including every interaction the contract requires.
When no Material Risk needs evidence beyond applicable mandatory gates, do not add verification work by convention.

When accepted intent or target-repository instructions retire a concept, identify its replacement, affected surfaces, targeted search scope, and accepted exceptions.
Use targeted diff, search, and inspection as one-time removal evidence.
Do not create durable evidence whose only purpose is to prove that a retired concept is absent.

This step is complete when every Claim has feasible, proportionate Evidence, each required interaction and mechanism is justified by the Claim, and every requirement for durable automation explains why maintained evidence is necessary and proportionate.

## 3. Write the contract

Keep behavioral acceptance criteria separate from the Task Verification Contract.
Use this structure and omit empty optional sections:

```markdown
## Verification

### Material risks

- <Plausible failure and meaningful consequence.>

### Required claims

- <Specific fact that evidence must establish.>

### Required evidence

- <Observation or artifact, naming a mechanism only when needed to observe an interaction that is part of the Claim.>

### Escalation

- <Condition that requires an intent amendment or external decision.>

### Not required

- <Likely scope misunderstanding that is explicitly excluded.>
```

Use `Not required` only for a likely scope misunderstanding.
When no Material Risk needs new evidence, use this minimal form:

```markdown
## Verification

Applicable mandatory gates provide sufficient evidence.
No additional durable evidence is required.
```

When the contract requires durable automated evidence, explain under `Required evidence` why maintained evidence is necessary and why its regression protection justifies its cost.
Do not prescribe individual test cases unless one is necessary to protect required confidence.

This step is complete when the contract states the required confidence without unnecessarily constraining implementation technique.

## 4. Confirm feasibility

Confirm that each required mechanism exists in the target repository or its supported environment.
Resolve a consequential unknown technique before recording the Task.
Do not assume that a future Implementer or reviewer has an unavailable tool.
If required confidence cannot be established feasibly, expose the unresolved requirement or product decision instead of silently weakening the contract.

Contract design is complete when the evidence is feasible and proportionate, the complete contract is part of the proposed Task Context, and no unsupported mechanism is required.
