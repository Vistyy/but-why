# Start prepared Changes

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Change Start creates Task-backed and taskless Changes with prepared Managed Worktrees.
- Repository Preparation is shared by implementation and validation workspaces.
- Failed preparation preserves a retryable Change and worktree.

## What to build

Replace Task Start with `by change start [--task <task-id>]`, move persistent worktree ownership under Change, migrate Repo Config to top-level `prepare`, and add explicit preparation retry through `by change prepare <change-id>`.
Completed Task 083 remains historical evidence of the replaced command contract.

## Primary verification seam

Change CLI tests against a real temporary Git repository and shared SQLite state.

## Acceptance criteria

- [x] `by change start` creates a taskless Change without title, description, or Acceptance Context.
- [x] `by change start --task <task-id>` requires an approved dependency-unblocked Task and captures its Acceptance Context.
- [x] Both forms create from the configured default branch and durably record the branch, starting commit, and Managed Worktree on the Change.
- [x] Native Git provisioning preserves existing recovery and conflict safety.
- [x] Repo Config exposes top-level `prepare`, and validation continues to use the same preparation definition.
- [x] Successful implementation preparation marks the Change ready.
- [x] Failed preparation records `prepare_failed`, preserves the Change and worktree, and returns actionable structured evidence.
- [x] `by change prepare <change-id>` retries preparation without creating another Change or worktree.
- [x] Human output remains TOON by default, while `--output json` returns stable machine-readable Change and readiness facts.
- [x] `by task start` and its Task-owned worktree authority are removed without a compatibility alias.
- [x] Change owns the surviving implementation-start modules; no separate top-level Task Start workflow remains.

## Blocked by

None - can start immediately.

## Completion

Implemented in `bdf6646`.
Verified with `just quality`.
