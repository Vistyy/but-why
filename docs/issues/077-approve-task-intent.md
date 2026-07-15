# Approve Task intent

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- A created Task begins as New and cannot start.
- An unstarted Task's title and description may be replaced atomically.
- Approval permanently and idempotently moves New to Todo.
- Approval does not create a Change, capture Acceptance Context, inspect dependencies, or change tags.

## What to build

Add the New state, pre-start title and description editing, and permanent Task Approval through the Task module and CLI.
Replace the current create-as-Todo behavior so Approval is the only path from New to Todo.

## Primary verification seam

Task CLI lifecycle test.

## Acceptance criteria

- [ ] Task creation returns and persists `new`.
- [ ] Title and description edits succeed for an unstarted nonterminal Task and preserve ordered comments.
- [ ] `by task approve <id>` atomically changes New to Todo.
- [ ] Repeated Approval of Todo is a successful no-op and does not create another lifecycle event.
- [ ] Dependencies do not block editing or Approval.
- [ ] Approval of a started or terminal Task returns its legal current actions without changing state.
- [ ] Approval never creates a Change, workspace, agent execution, or Acceptance Context snapshot.

## Open decisions to grill

- Exact edit command and AXI schemas.
- Title and description size limits and file-input behavior.
- Lifecycle event fields and no-op output.

## Blocked by

None - can start immediately.
