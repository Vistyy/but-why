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
Use the least costly supported seam that observes the complete Claim.
Use integration or end-to-end evidence only when interaction across that boundary is part of the Claim.
Treat existing tests and checks as evidence inventory, not as authority for the required technique or seam.
Do not use test count, coverage percentage, file category, or integration level as a substitute for a Claim.

Evidence can include type checking, static analysis, focused commands, tests, inspection, rendered behavior, logs, traces, reproducible procedures, measurements, experiments, and mandatory repository gates.
These examples do not limit the available techniques.
Lifecycle cost includes authoring and review, code and fixture size, execution time and resources, stability, failure diagnosis, coupling, and future maintenance.
Do not use a numerical score or test-to-production line ratio to replace judgment about confidence and cost.

Require a durable automated test or coherent test group only when it detects a distinct plausible regression failure, existing retained evidence and proportionate one-time evidence are insufficient, the selected seam observes the Claim reliably, and the distinct confidence gained justifies lifecycle cost.
Before requiring durable automation, state the distinct regression failure, why existing or one-time evidence is insufficient, and why lifecycle cost is proportionate.
For each additional durable case, identify the materially distinct failure that retained evidence would otherwise miss.
Consolidate or omit cases that add no distinct failure, especially when they repeat the same Claim through an equally or more expensive seam.
Do not translate each accepted-behavior statement or evidence example into a test.

Specify a mechanism or seam only to the precision needed to protect required confidence.
An Implementer may use another mechanism that establishes the same Claim through every materially required seam.
When no Material Risk needs evidence beyond applicable mandatory gates, do not add verification work by convention.

When accepted intent or target-repository instructions retire a concept, identify its replacement, affected surfaces, targeted search scope, and accepted exceptions.
Use targeted diff, search, and inspection as one-time removal evidence.
Do not create durable evidence whose only purpose is to prove that a retired concept is absent.

This step is complete when every Claim has feasible, proportionate Evidence, each required seam is justified by the Claim, and every required durable test or test group satisfies the admission rule.

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

- <Observation or artifact, with a mechanism or seam only when materially required.>

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

When the contract requires durable automated evidence, record its admission reasons under `Required evidence`.

This step is complete when the contract states the required confidence without unnecessarily constraining implementation technique and every durable-evidence requirement includes its admission reasons.

## 4. Confirm feasibility

Confirm that each required mechanism and seam exists in the target repository or its supported environment.
Resolve a consequential unknown technique before recording the Task.
Do not assume that a future Implementer or reviewer has an unavailable tool.
If required confidence cannot be established feasibly, expose the unresolved requirement or product decision instead of silently weakening the contract.

Contract design is complete when the evidence is feasible and proportionate, the complete contract is part of the proposed Task Context, and no unsupported mechanism is required.
