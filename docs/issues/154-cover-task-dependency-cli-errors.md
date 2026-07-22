# Cover Task dependency CLI errors

## Status

Done.

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

## Scoped implementation record

- Baseline: `fe1b3dbfc222d20ce6f43f9b334257f1aaeaae47`.
- Spec review source: this task draft.
- Normative traceability: Task 150, the Taskless Changes and worktree handoff specification, and the Change-centered validation PRD.
- Primary seam: Task CLI JSON results for `by task create` and `by task dependencies set`.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Task creation reports reachable dependency rejections | `src/cli/task/commands/create.ts` | Real Task CLI JSON creation results | Unknown, self, and duplicate dependency results preserve their complete contract and graph state |
| Create retains defensive cycle mapping | `src/cli/task/commands/create.ts` | CLI mapping seam with a rejected use-case result | The unreachable cycle result preserves its code, message, and help without a malformed graph fixture |
| Dependency replacement reports every rejection | `src/cli/task/commands/dependencies.ts` | Real Task CLI JSON replacement results | Unknown, self, duplicate, cycle, locked, and missing Task results preserve their complete contract |
| Rejected operations preserve the graph | Task dependency persistence and both Task CLI commands | `task show --output json` for every affected Task | Prerequisites, dependents, and Task existence remain unchanged after each rejection |
| Task Dependency CLI health findings are resolved | CLI mapping coverage | Full coverage and Fallow health reports | The two Task Dependency mapping findings are absent and no new Task Dependency finding appears |
| Focused tests and quality checks pass | Repository test and quality recipes | Just recipes | Focused tests, type checking, static checks, coverage, and build pass |

## Implementation decision ledger

- Local: use real initialized repositories for every reachable persistence rejection and inspect every affected Task through the CLI.
- User-approved: remove create-time dependency-cycle end-to-end coverage because a valid create operation cannot form a cycle before the new Task exists.
- Local: retain a CLI mapping test for the unreachable create-time cycle result so the existing defensive contract remains covered without corrupting storage.
- Deferred to Task 155 and Task 157: pre-existing Fallow health findings outside Task Dependency CLI behavior.

## Primary verification seam

Task CLI JSON results for `by task create` and `by task dependencies set` demonstrate every reachable Task Dependency rejection without graph mutation.
The create command's unreachable dependency-cycle mapping is covered at the CLI mapping seam.

## Acceptance criteria

- [x] Task creation covers unknown Task, self-dependency, and duplicate dependency rejections.
- [x] Task creation retains defensive mapping for the unreachable dependency-cycle result.
- [x] Task Dependency replacement covers unknown Task, self-dependency, duplicate dependency, dependency-cycle, locked-dependency, and missing-Task rejections.
- [x] Every reachable rejection preserves its current error code, message, details, and help.
- [x] Every reachable rejected operation leaves the Task Dependency graph unchanged.
- [x] The two Task Dependency CLI health findings are resolved without new quality findings.
- [x] Focused Task CLI tests and the repository quality gate pass.

## Completion

- Implementation commits: `e21fb456ccd5937a869e330a688cf3839df3afa5`, `b2e7960ff72494af162e55fd548e00e91fb4e64`, `36983d2fd2b2100688eb1db95dd93e8c9f5c832c`, and `969a10994534047fa4a3234befbbf2414a90fbd3`.
- Verification: focused Task CLI tests, type checking, formatting, linting, AST-grep, and documentation checks passed.
- Review: Spec approved and Standards review pending final correction validation.

## Blocked by

None - can start immediately.
