# Launch a Change Implementer in Herdr

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`

## Behaviors owned

- Change Implement launches a visible Herdr child workspace and fresh Pi session in a ready Managed Worktree.
- A user-invoked skill can hand the current work to that fresh session without copying the conversation.

## What to build

Add `by change implement <change-id> [--handoff-file <path>]` and ship the user-only `handoff-to-worktree` skill over existing Change-owned Git state.
Add a narrow Interactive Session Host interface and implement only its Herdr adapter.
Do not add provider selection, registration, or generic provider machinery.

## Primary verification seam

Change Implement tests against a fake Interactive Session Host, a static skill contract test, and one local Herdr smoke test.
The fake-host tests cover `started`, `already_active`, host-unavailable, and launch-failure results.
File-contract tests cover regular non-empty UTF-8 input through 256 KiB.
The smoke test verifies the stable session name and existing-worktree launch against an already-running Herdr host.

## Acceptance criteria

- [x] Change Implement accepts only a ready Change and passes its recorded Managed Worktree to the Interactive Session Host as the working directory.
- [x] Herdr must already be installed and running, and its adapter opens the existing worktree rather than creating or owning Git state.
- [x] A fresh Pi session starts in that worktree with the Change identity and optional handoff as its initial prompt.
- [x] Each Managed Worktree has one stable Herdr session name, and a repeated launch returns `already_active` without creating a duplicate Active Interactive Session.
- [x] But Why? does not persist Herdr workspace or session identifiers.
- [x] A successful JSON result reports the Change ID, worktree path, `herdr` host, and `started` or `already_active` status.
- [x] Host-unavailable and launch failures preserve the prepared Change and return actionable, retryable errors.
- [x] `--handoff-file` accepts only a regular, non-empty UTF-8 file of at most 256 KiB and does not accept standard input.
- [x] `handoff-to-worktree` is user-invoked only and contains its own compact handoff instructions.
- [x] The skill creates its handoff in the operating system temporary directory and removes it after Change Implement returns.
- [x] The skill calls Change Start and Change Implement with `--output json` and reports failures in the current session.
- [x] Global Config has no Herdr setting, and `by init` does not check Herdr availability.
- [x] The integration does not copy, fork, or retarget the current Pi session.

## Blocked by

- `docs/issues/133-start-prepared-changes.md`

## Completion

Implemented in `c6ac058` and updated in this completion commit.
Verified with `just quality` and the local Herdr smoke test.
