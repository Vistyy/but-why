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

Cover every Task Dependency rejection through the Task CLI.

Preserve the existing error codes, messages, details, and help.
Simplify the error mapping only if public coverage does not remove the health findings.

## Primary verification seam

Task CLI JSON results for `by task create` and `by task dependencies set` demonstrate every Task Dependency rejection without graph mutation.

## Acceptance criteria

- [ ] Task creation covers unknown Task, self-dependency, duplicate dependency, and dependency-cycle rejections.
- [ ] Task Dependency replacement covers unknown Task, self-dependency, duplicate dependency, dependency-cycle, locked-dependency, and missing-Task rejections.
- [ ] Every rejection preserves its current error code, message, details, and help.
- [ ] Every rejected operation leaves the Task Dependency graph unchanged.
- [ ] The two Task Dependency CLI health findings are resolved without new quality findings.
- [ ] Focused Task CLI tests and the repository quality gate pass.

## Blocked by

None - can start immediately.
