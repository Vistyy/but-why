# Launch a Change Implementer in Herdr

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`

## Behaviors owned

- Change Implement launches a visible Herdr workspace and fresh Pi session in a ready Managed Worktree.

## What to build

Add `by change implement <change-id> [--handoff-file <path>]` over existing Change-owned Git state.
Add a narrow Interactive Session Host interface and implement only its Herdr adapter.
Do not add provider selection, registration, or generic provider machinery.

## Implementation decision ledger

- Local: Use `but-why-<change-id>` as the stable Herdr session name.
  Change IDs have a one-to-one relationship with Managed Worktrees.
- Local: Open the recorded worktree with `herdr worktree open`.
  Run Pi in the returned root pane with `herdr pane run`.
  Name that pane with `herdr agent rename`.
- Local: Pass the caller `PATH` to `pane run`.
  Herdr runs as a persistent server and does not inherit the caller shell path.
- Local: `handoff-to-worktree` is user-owned Pi configuration.
  But Why does not ship, install, or configure the skill.
- Local: If Pi starts but agent naming fails, send `ctrl-c` to the root pane.
  Herdr 0.7.3 has no process-specific stop command, so it cannot confirm that the Pi process exited.
- Deferred: Herdr 0.7.3 has no atomic session-name claim across `pane run` and `agent rename`.
  A concurrent name collision returns a retryable launch failure.
  A concurrent-launch coordinator needs its own approved task.

## Primary verification seam

Change Implement tests against a fake Interactive Session Host and one local Herdr smoke test.
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
- [x] Global Config has no Herdr setting, and `by init` does not check Herdr availability.
- [x] The integration does not copy, fork, or retarget the current Pi session.

## Blocked by

- `docs/issues/133-start-prepared-changes.md`

## Completion

Implemented through `c988113`.
Verified with `just quality`, the local one-pane Herdr smoke test, and the background-focus smoke test.
