# Launch a Change Implementer in Herdr

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`

## Behaviors owned

- Change Implement launches a visible Herdr child workspace and fresh Pi session in a ready Managed Worktree.
- A user-invoked skill can hand the current work to that fresh session without copying the conversation.

## What to build

Add `by change implement <change-id> [--handoff-file <path>]` and ship the user-only `handoff-to-worktree` skill as one Herdr integration over existing Change-owned Git state.
Do not build a generic session-provider framework.

## Primary verification seam

Change Implement tests against a fake Herdr adapter, a static skill contract test, and one local Herdr smoke test.

## Acceptance criteria

- [ ] Change Implement accepts only a ready Change and uses its recorded Managed Worktree.
- [ ] Herdr opens the existing worktree rather than creating or owning Git state.
- [ ] A fresh Pi session starts in that worktree with the Change identity and optional handoff as its initial prompt.
- [ ] `--handoff-file` is read through a bounded, actionable input contract.
- [ ] Launch failure preserves the prepared Change and returns a retryable result.
- [ ] Repeated launch does not create a duplicate active Implementer.
- [ ] `handoff-to-worktree` is user-invoked only and contains its own compact handoff instructions.
- [ ] The skill writes its handoff to the operating system temporary directory.
- [ ] The skill calls Change Start and Change Implement with `--output json` and reports failures in the current session.
- [ ] The integration does not copy, fork, or retarget the current Pi session.

## Blocked by

- `docs/issues/133-start-prepared-changes.md`
