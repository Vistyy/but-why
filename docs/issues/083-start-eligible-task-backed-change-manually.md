# Start an eligible Task-backed Change manually

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Manual Task Start claims one eligible Todo Task without launching an agent.
- Start atomically rechecks dependencies, fixes pre-start Task fields, links the Change and workspace, and captures Acceptance Context.
- Repeated Start returns the existing claim as a no-op.

## What to build

Implement `by task start <id>` through the same durable claim boundary later used by AFK pickup.
Create or reuse the Task's single Change and managed workspace without starting implementation automation.

## Primary verification seam

Task Start CLI test in a temporary repository.

## Acceptance criteria

- [ ] Start succeeds only for approved, unheld Todo with every prerequisite Done.
- [ ] Eligibility is rechecked in the transaction that creates the claim.
- [ ] Success atomically changes Todo to implementing and creates or reuses one linked Change and managed workspace.
- [ ] Success captures the latest Task Context as immutable Acceptance Context.
- [ ] Success fixes title, description, tags, and dependencies against later mutation.
- [ ] Success does not launch an agent or validation.
- [ ] Repeated Start returns the existing Change and workspace without another snapshot or lifecycle event.
- [ ] A conflicting branch or Change binding is rejected without a partial claim.

## Open decisions to grill

- Exact success, no-op, and eligibility-error schemas.
- Workspace path disclosure and conflicting-branch recovery guidance.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
- `docs/issues/079-manage-task-dependency-graph.md`
