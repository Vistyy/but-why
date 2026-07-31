---
status: provisional
artifact_kind: working-plan
remove_when: accepted simplification work is recorded as approved Tasks and applicable current documentation
---

# Codebase simplification audit

> Non-authoritative working plan.
> This file preserves a separate follow-up to the verification portfolio redesign.
> Agents must use it only when the operator or an active Task explicitly identifies it as planning context.

## Outcome

But Why should contain only the product behavior, safeguards, abstractions, and compatibility paths justified by accepted requirements or concrete project evidence.
The audit must identify simpler designs that preserve every required observable behavior.

## Entry condition

Do not start this audit until the verification portfolio defines approved Material Risks, Verification Claims, and evidence ownership.
Use those accepted claims as the behavioral boundary for simplification.
The exact sequence relative to the Task Submission planning gate remains unresolved.

## Method

1. Identify code that supports no accepted requirement, Verification Claim, or concrete failure.
2. Trace each candidate through its callers, state, external boundaries, and maintained evidence.
3. Distinguish necessary domain complexity from complexity introduced for hypothetical flexibility or maximum prevention.
4. Design the smallest coherent replacement that preserves accepted behavior.
5. Obtain operator approval for the target design before creating implementation Tasks.
6. Split approved changes into independently useful vertical Tasks.
7. Remove each replaced implementation, compatibility path, unused abstraction, and old caller in the same applicable Task.

## Candidate signals

Investigate these signals without treating them as established defects:

- A general abstraction with only one required behavior or owner.
- Duplicate identity or provenance fields that no accepted boundary uses.
- Process supervision or recovery machinery without a concrete failure it must prevent.
- Runtime compatibility machinery for an unreleased interface or schema.
- Configuration, environment, or agent attestation beyond the resolved identity used by execution.
- Defensive state that cannot affect a supported public operation.
- A compatibility path, feature flag, or fallback for behavior the project does not support.
- Multiple evidence or control layers that protect the same accepted claim without distinct value.

## Recorded candidates

### Reviewer Session identity snapshot

SQLite stores a complete Reviewer Session identity JSON snapshot and a fingerprint of that snapshot.
Validation Run reuse already uses the immutable Validation Policy Snapshot.
Reviewer Session continuation appears to require only the current identity fingerprint, stored fingerprint, Change ID, reviewer producer, session reference, and last Candidate ID.
Investigate removing the stored identity JSON if no inspection, recovery, or compatibility requirement uses it.
Preserve explicit restart when the stored fingerprint or session reference is unusable.

## Boundaries

Do not remove a safeguard because its implementation is difficult or visually complex.
Remove or simplify it only when accepted behavior and concrete evidence do not justify its cost.
Do not mix production simplification into verification-portfolio Tasks.
The verification redesign may record candidates but must not refactor production code opportunistically.
Do not use test count, code coverage, line count, or abstraction count as the simplification target.

## Completion

The audit is complete when every approved simplification preserves accepted behavior, each implementation Task has a Task Verification Contract, and no retained complexity lacks an identified owner or consequence.

## Approval

The operator approved this follow-up approach.
The target simplifications, Task sequence, and placement relative to the Task Submission planning gate remain provisional.
