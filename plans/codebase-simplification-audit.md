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

## Entry condition and sequence

Start this audit after the verification portfolio migration and closure are complete.
Use the accepted Material Risks, Verification Claims, and evidence ownership as the behavioral boundary for simplification.
Complete each approved shared-foundation simplification that Planning would otherwise consume before Task Submission Slice 3.

The pre-v1 Shared Repository State reset remains a separate optional decision.
Evaluate it only after Planning Slices 3 and 4 and other active work are complete, BY-53 provides validated Task Archives, and the operator is ready to decide whether to discard non-Task history.
The reset does not block verification portfolio work, shared-foundation simplification, or the Task Submission planning gate.

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

### Pre-v1 Shared Repository State reset

After active work is complete and BY-53 provides validated append-only Task Archives, evaluate whether the first public release should start from a new clean database and consolidated baseline instead of carrying the pre-release migration chain.
This is a low-to-medium priority simplification candidate, not current verification-portfolio work.
A reset is eligible only when the operator accepts discarding Change, Candidate, Validation Run, Finding, Artifact, reviewer-session, and publication history because Task Archives preserve Tasks only.
The decision must define one release boundary that retires old source executables and pre-reset databases, validates Task restoration into the new schema, and supersedes ADR 0009 before any Migration Artifact is rewritten.
If those conditions are not met, retain the immutable chain and append the next migration.

## Boundaries

Do not remove a safeguard because its implementation is difficult or visually complex.
Remove or simplify it only when accepted behavior and concrete evidence do not justify its cost.
Do not mix production simplification into verification-portfolio Tasks.
The verification redesign may record candidates but must not refactor production code opportunistically.
Do not use test count, code coverage, line count, or abstraction count as the simplification target.

## Completion

The audit is complete when every approved simplification preserves accepted behavior, each implementation Task has a Task Verification Contract, and no retained complexity lacks an identified owner or consequence.

## Approval

The operator approved this follow-up approach and its placement after verification portfolio closure and before Task Submission Slice 3.
The target simplifications remain provisional until their audit evidence and designs receive operator approval.
The pre-v1 Shared Repository State reset remains a separate optional decision after the planning gate and active work.
