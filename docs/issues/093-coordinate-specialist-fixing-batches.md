# Coordinate Specialist fixing batches

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Every open Finding from one Specialist phase enters one Fixer batch.
- A committed successor Candidate restarts the gate from Prepare.
- After earlier phases pass, only Specialists with prior Findings rerun.
- The Fixer makes and records decisions while only orchestration may record Needs Input from a verified missing successor Candidate or exhausted budget.

## What to build

Coordinate the complete multi-Specialist revision loop without a separate compatibility classifier.
Keep Findings immutable and create resolution links only from later clean Specialist results.

## Primary verification seam

Two-Specialist revision-loop test.

## Acceptance criteria

- [ ] One Fixer receives every open Finding produced by the blocking Specialist phase.
- [ ] Specialist Findings never mix with Check, Acceptance, or Final Findings.
- [ ] The Fixer records one Code-Writing Execution and must commit one clean successor Candidate.
- [ ] A successor Candidate starts a new Run from Prepare.
- [ ] After earlier phases pass, only Specialists whose prior result had Findings rerun.
- [ ] Each rerun starts with blind review and then checks its own prior Findings in the same fresh session.
- [ ] A clean result creates explicit resolution links for the prior Findings it covers.
- [ ] New Findings remain open and continue the Specialist loop.
- [ ] Agent uncertainty or disagreement becomes an Implementation Decision and never an agent-controlled stop.
- [ ] But Why? records Needs Input only after code verifies that the execution produced no clean successor Candidate or the budget is exhausted, preserving the execution evidence and open Findings.
- [ ] The Specialist phase completes only when every configured Specialist has eligible clean evidence and no Specialist Finding remains open.

## Open decisions to grill

- Exact Fixer input ordering and bounded Finding content.
- Resolution rules when a reviewer repeats a Finding with changed wording.
- Exact loop progress and Needs Input AXI schemas.

## Blocked by

- `docs/issues/090-run-unfinished-specialists-in-parallel.md`
- `docs/issues/092-verify-one-specialist-revision.md`
