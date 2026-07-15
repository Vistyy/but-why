# Expand: validate a standalone Candidate through checks

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- `by validate` captures clean committed standalone work and judges it through Prepare and every configured check.
- One Candidate and exact immutable input set select one Validation Run with Execution Attempt 1.
- A fresh exact workspace, opaque Artifacts, Findings, Tooling Failures, Run outcome, and Change-level Needs Input are durable.
- Reviewer, Fixer, and `copyFiles` policy are rejected until their later vertical slices exist.

## What to build

Expand Candidate-owned storage and the public `by validate` path through one complete checks-only gate.
Keep publication and Task state mutation outside the Validation Gate.

## Primary verification seam

End-to-end CLI test in a temporary repository.

## Acceptance criteria

- [ ] `by validate` rejects dirty or uncommitted work before durable validation mutation.
- [ ] The command selects or creates the branch's open Change and exact Candidate through existing provenance rules.
- [ ] Resolved checks-only policy and optional Acceptance Context identity form immutable Run inputs.
- [ ] After preflight, one transaction creates or reuses the Change, Candidate, Run, and active Attempt, with no partial durable request on transaction failure.
- [ ] Workspace and command failures after that transaction are recorded on the durable Attempt.
- [ ] A matching request reuses the current Run, while changed Candidate or inputs create a new Run and supersede an active older one.
- [ ] Attempt 1 receives a fresh workspace at the exact Candidate.
- [ ] Prepare runs first when configured.
- [ ] A failed or timed-out Prepare command creates a Finding and stops checks.
- [ ] Every configured check runs sequentially after ordinary check failures or timeouts.
- [ ] But Why? verifies Candidate `HEAD`, index, tracked contents, and executable bits after Prepare and every check.
- [ ] Temporary untracked files are allowed, while tracked mutation ends the Attempt as `tooling_failed`.
- [ ] Command results and logs are stored under opaque Artifact UUIDs with explicit provenance metadata.
- [ ] Completed unsuccessful commands create Findings, while inability to execute, observe, or persist validation creates a Tooling Failure.
- [ ] A trustworthy Attempt with no Findings completes the Run as `passed`.
- [ ] A trustworthy Attempt with Findings completes the Run as `blocked`, and the checks-only slice records Change-level Needs Input from those Findings because it has no automatic Fixer path yet.
- [ ] Unsupported reviewer, Fixer, or `copyFiles` policy is rejected before Run creation with an actionable error.
- [ ] Output is structured, bounded, and distinguishes passed, blocked, Tooling Failure, and Submit Rejection.

## Open decisions to grill

- Exact `by validate` options, no-args behavior, and AXI schemas.
- Canonical Validation Policy Snapshot encoding and fingerprint fields.
- Workspace integrity algorithm and Artifact content limits.

## Blocked by

None - can start immediately.
