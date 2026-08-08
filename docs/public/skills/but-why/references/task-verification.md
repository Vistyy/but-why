# Task verification

Use this reference to design or revise a Task Verification Contract.
The contract states the confidence required for one implementation Task without prescribing implementation techniques unnecessarily.

## Terms

**Material Risk** is a plausible way implementation can fail accepted intent with a meaningful consequence, supported by accepted requirements or concrete target-repository evidence.

**Verification Claim** is one fact that evidence must establish to address one Material Risk.

**Verification Evidence** is an interpretable observation or artifact that supports or refutes one Verification Claim.

**Task Verification Contract** is the Task Context section that records Material Risks, required Verification Claims and Evidence, escalation conditions, and explicit exclusions.
It is preserved in Acceptance Context when the Task starts.

**Distinct Regression Failure** is a plausible regression that other selected or retained Verification Evidence would not reveal.
A different input, fixture, branch, assertion, or code path does not make a failure distinct by itself.

**Lifecycle Cost** is the total cost of Verification Evidence across authoring, review, code and fixtures, execution, stability, failure diagnosis, coupling, and maintenance compared with the least-cost feasible Evidence for the same Claim.

## Design the contract

1. Identify the Material Risks introduced or affected by the Task.
   Do not use numerical risk scoring.
   Do not invent guarantees, speculative edge cases, or risks unsupported by accepted intent or repository evidence.
2. Define only the Verification Claims needed to address those risks.
   A requirement, code change, branch, or scenario does not by itself require a separate Claim.
   A Claim must not require a stronger product guarantee than accepted intent justifies.
3. Select the least-cost feasible Evidence that establishes each Claim reliably.
   Start with applicable mandatory gates, retained Evidence, focused execution, inspection, and other proportionate one-time Evidence.
   Use integration or end-to-end Evidence only when the Claim includes that interaction.
   Specify a mechanism only when the Claim requires it.
   An Implementer may use another mechanism that establishes the complete Claim through every required interaction.
4. Confirm that every required mechanism exists in the supported environment.
   Expose an unresolved confidence or feasibility problem instead of silently weakening the contract.

Do not require tests by default.
A requirement, code change, branch, scenario, or Verification Claim does not by itself require new durable automation.
Do not require a new test or expanded durable coverage unless all applicable conditions are true:

- It protects accepted supported behavior, an interface, an invariant, or a reproduced defect class.
- It detects a Distinct Regression Failure supported by accepted requirements or concrete evidence.
- Retained Evidence and proportionate one-time Evidence do not establish the Claim sufficiently.
- The selected seam observes the Claim reliably.
- The additional protection justifies its Lifecycle Cost over the least-cost feasible alternative.

When every condition establishes that maintained regression protection is necessary and proportionate, require that protection without prescribing a more expensive mechanism than the Claim requires.
Before requiring new or expanded durable coverage, state the Distinct Regression Failure, why retained and one-time Evidence are insufficient, and why Lifecycle Cost is proportionate.
Apply the conditions to each additional test case, including each parameterized case.
Prefer updating, reusing, consolidating, or removing retained Evidence when that provides sufficient confidence at lower Lifecycle Cost.
Updating an existing expectation because the accepted contract changed preserves that Evidence and does not by itself justify another test case or suite.
Do not derive tests from test counts, coverage targets, existing test habits, or one-test-per-requirement conventions.
Accepted repository mandatory gates remain binding.

When accepted intent retires a concept, use targeted diff, search, and inspection as one-time Evidence for its replacement and affected surfaces.
Do not create durable Evidence whose only purpose is to prove that a retired concept is absent.

## Write the contract

Keep behavioral acceptance criteria separate from verification.
Use this structure and omit empty optional sections:

```markdown
## Verification

### Material risks

- <Plausible failure and meaningful consequence.>

### Required claims

- <Fact that evidence must establish.>

### Required evidence

- <Least-cost feasible evidence, naming a mechanism only when the Claim requires it.>

### Escalation

- <Condition requiring an intent amendment or external decision.>

### Not required

- <Likely scope misunderstanding explicitly excluded.>
```

Use `Not required` only for a likely scope misunderstanding.
When applicable mandatory gates provide sufficient Evidence, state that no additional durable Evidence is required.

Contract design is complete when every Material Risk has sufficient Claims, every Claim has feasible and proportionate Evidence, every mandatory gate remains included, and no Evidence requirement imposes an unsupported product guarantee or mechanism.
