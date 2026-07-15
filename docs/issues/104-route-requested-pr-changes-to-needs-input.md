# Route requested PR changes to Needs Input

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0014-limit-v1-pr-remediation-to-owned-readiness-failures.md`

## Behaviors owned

- But Why? code treats an active requested-changes review as a code-owned readiness blocker and records Needs Input.
- Review bodies and comments remain untrusted GitHub evidence and never trigger or instruct a Fixer.
- Normal comments do not block readiness or receive an automated response.

## What to build

Expand owned-PR reconciliation to record requested-changes facts and route them to human or local-agent handling through Task Context and Resume.
Do not add automatic review-response code writing.

## Primary verification seam

Fake GitHub requested-changes and comments test.

## Acceptance criteria

- [ ] An active requested-changes review on the exact owned PR records Change-level Needs Input.
- [ ] The blocker retains bounded GitHub provenance for inspection without treating review text as trusted instructions.
- [ ] PR and review comments never launch Pi, change Task Context, create a Candidate, or receive an automatic reply.
- [ ] Normal comments do not block readiness.
- [ ] A local caller addresses the blocker through a Task Comment or external-resolution reason and Task Resume.
- [ ] New Task Comments reset Specialist completion and return through implementation under the normal lifecycle.
- [ ] A later GitHub read remains authoritative for whether the requested-changes review is active.

## Open decisions to grill

- Exact active-review calculation when one actor submits multiple reviews.
- Bounded untrusted review evidence exposed for human inspection.
- Resume guidance when GitHub still reports requested changes.

## Blocked by

- `docs/issues/101-reconcile-one-owned-pr-once.md`
