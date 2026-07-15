# Implement one eligible AFK Task

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- A direct worker atomically claims the first eligible AFK Task in Task Queue Order.
- Eligibility requires Todo, `afk`, no Hold, no existing claim, and every prerequisite Done.
- One automatic Task may run per repository.

## What to build

Use the shared Task Start claim boundary to launch one Pi Implementer in a managed Change Workspace and commit its initial Candidate.

## Primary verification seam

Direct worker and fake Pi test.

## Acceptance criteria

- [ ] Pickup scans Task Queue Order and skips every ineligible Task without reordering it.
- [ ] The worker claims at most one eligible Task atomically.
- [ ] Manual Start and AFK pickup cannot both win the claim.
- [ ] The claim captures current Task Context as Acceptance Context.
- [ ] The Implementer runs only after the durable claim and writes only in the managed workspace.
- [ ] A clean committed result becomes the initial Candidate.
- [ ] The Implementer makes and records its decisions and attempts the complete Task without requesting Needs Input or changing lifecycle state.
- [ ] If code verifies that a completed execution produced no repository change, orchestration records Needs Input so a caller may Complete it or add guidance and Resume.
- [ ] Process and tooling failures use their code-owned recovery policy, and only exhausted recovery may record Needs Input.
- [ ] One repository never owns two automatic Task implementations concurrently.

## Open decisions to grill

- Worker idle behavior when no Task is eligible.
- Exact no-change Implementer result before a caller chooses Task Complete.

## Blocked by

- `docs/issues/078-manage-built-in-task-tags.md`
- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/080-order-and-reorder-tasks.md`
- `docs/issues/083-start-eligible-task-backed-change-manually.md`
- `docs/issues/091-fix-check-findings-with-pi.md`
