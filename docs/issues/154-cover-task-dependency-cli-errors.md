# Cover Task dependency CLI errors

## Specification

- [Task and Change Start storage migration](150-migrate-task-and-change-start-storage.md)
- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)
- [Change-centered validation PRD](../prds/change-centered-validation-prd.md)

## Behaviors owned

- Task creation reports each Task Dependency rejection through the existing structured CLI contract.
- Task Dependency replacement reports each Task Dependency rejection through the existing structured CLI contract.
- A rejected Task Dependency operation preserves the current Task Dependency graph.

## What to build

Cover every reachable Task Dependency rejection through the Task CLI.

Preserve the existing error codes, messages, details, and help.
Retain defensive mapping for the unreachable create-time dependency-cycle result without inventing a malformed graph fixture.
Simplify the error mapping only if public coverage does not remove the health findings.

## Primary verification seam

Task CLI JSON results for `by task create` and `by task dependencies set` demonstrate every reachable Task Dependency rejection without graph mutation.
The create command's unreachable dependency-cycle mapping is covered at the CLI mapping seam.

## Acceptance criteria

- [ ] Task creation covers unknown Task, self-dependency, and duplicate dependency rejections.
- [ ] Task creation retains defensive mapping for the unreachable dependency-cycle result.
- [ ] Task Dependency replacement covers unknown Task, self-dependency, duplicate dependency, dependency-cycle, locked-dependency, and missing-Task rejections.
- [ ] Every reachable rejection preserves its current error code, message, details, and help.
- [ ] Every reachable rejected operation leaves the Task Dependency graph unchanged.
- [ ] The two Task Dependency CLI health findings are resolved without new quality findings.
- [ ] Focused Task CLI tests and the repository quality gate pass.

## Blocked by

None - can start immediately.
