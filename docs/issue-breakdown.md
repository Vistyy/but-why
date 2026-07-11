# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

The target architecture is approved by `docs/adr/0008-use-change-as-validation-and-delivery-owner.md` and specified by `docs/prds/change-centered-validation-prd.md`.

Done issues are omitted from this graph.

## Can start immediately

- `040-add-effect-scheduled-github-polling.md`
- `046-publish-by-to-npm-registry.md`
- `047-design-but-why-agent-skill-workflow-content.md`
- `049-configure-default-agent-harness-during-setup.md`
- `051-capture-and-inspect-standalone-change.md`
- `054-link-tasks-and-project-initial-status.md`

## Change-centered dependency graph

```text
051 capture and inspect standalone Change
  -> 052 validate Candidate checks without Task
    -> 053 freeze policy and make validation idempotent

054 link Tasks and project initial status
  -> 068 add Task dependencies and eligibility

049 default agent harness + 053 validation idempotency
  -> 055 shared reviewer runner
    -> 056 selective Specialist Reviewers

049 default agent harness + 053 validation idempotency
  -> 057 Code-Writing Executions and check fixing

056 Specialists + 057 Code-Writing Executions
  -> 058 Specialist fixing loop

054 Task links + 055 reviewer runner + 058 Specialist loop
  -> 059 final gates and complete by validate

054 Task links + 057 Code-Writing Executions + 059 final gates
  -> 060 Change-owned Needs Input and resume

053 validation idempotency + 059 final gates + 060 Needs Input
  -> 061 exact-head submit

040 GitHub polling + 061 exact-head submit
  -> 062 PR reconciliation

054 Task links + 057 Code-Writing Executions + 068 Task dependencies
  -> 063 Task-backed Implementer Executions

061 exact-head submit + 063 Implementer Executions + 068 Task dependencies
  -> 064 AFK repository worker pickup
    -> 065 register and launch repository workers

062 PR reconciliation + 065 worker launch
  -> 069 recover and govern repository workers

056 Specialists + 057 Code-Writing Executions + 060 Needs Input
+ 061 exact-head submit + 062 PR reconciliation
  -> 066 Change activity and usage

056 Specialists + 059 final gates
  -> 067 reviewer eval harness

054 Task links + 068 Task dependencies
  -> 071 cancel Task and Change

052 Candidate checks + 054 Task projection + 059 final gates
+ 060 Needs Input + 061 exact-head submit + 062 PR reconciliation
+ 063 Implementer Executions + 064 AFK pickup + 066 observability
+ 068 Task dependencies
  -> 070 contract Task-owned validation and delivery
```

## Independent work

```text
046 publish by to npm registry
047 agent skill workflow content
```

## Deferred

- `048-add-planning-phase-intent-reviewer.md` starts after Planning Phase architecture and the Task-readiness workflow are designed.

## Migration notes

- Issues 051 through 067 migrate complete product paths.
- Issue 068 adds Task dependency storage and start or pickup eligibility.
- Issue 069 hardens multi-repository worker operation.
- Issue 071 adds explicit Task cancellation and cancelled Change closure.
- Issue 070 is the contract step that removes the old Task-owned path after every required ownership migration is complete.
- Cancelled-prerequisite behavior remains unresolved.
- The obsolete planned issues 014 through 021 were replaced by the Change-centered slices.
