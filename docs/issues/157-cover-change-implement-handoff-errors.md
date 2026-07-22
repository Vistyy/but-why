# Cover Change Implement handoff errors

## Specification

- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)
- [Launch a Task implementer in Herdr](130-launch-task-implementer-in-herdr.md)

## Behaviors owned

- Change Implement maps every invalid handoff file to its existing structured CLI usage error.
- Invalid handoff input prevents Interactive Session launch and preserves Change state.
- A valid handoff remains unchanged when Change Implement supplies it to the Interactive Session Host.

## What to build

Cover every handoff-file rejection through the Change Implement CLI.

Preserve the existing error codes, paths, messages, details, and help.
Simplify the error mapping only if public coverage does not remove the health finding.

## Primary verification seam

Change Implement CLI JSON results demonstrate every handoff-file rejection and confirm that the Interactive Session Host does not launch.

## Acceptance criteria

- [ ] Change Implement covers missing, unreadable or non-regular, oversized, invalid UTF-8, and empty handoff files.
- [ ] Every rejection preserves its current error code, path, message, details, and help.
- [ ] Invalid handoff input prevents Interactive Session Host launch and repository-state mutation.
- [ ] Standard input remains rejected with `unsupported_stdin_handoff_file`.
- [ ] Valid non-empty UTF-8 handoffs up to 256 KiB continue unchanged to the Interactive Session Host.
- [ ] The Change Implement handoff error health finding is resolved without new quality findings.
- [ ] Focused Change Implement tests and the repository quality gate pass.

## Blocked by

None - can start immediately.
