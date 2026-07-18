# V1 issue breakdown

## Release boundary

V1 is the Change-centered workflow defined by `docs/specs/taskless-changes-and-worktree-handoff.md`.
It ends when But Why? completes one real SQLite-tracked Task-backed Change and publishes the verified npm package.

## Can start immediately

- Task 096: Run built-in Acceptance Review.
- Task 133: Start prepared Changes.

## Completed

- Task 083: Start a Task in a managed worktree (`f009ab6`).
- Task 084: Expand Candidate-owned validation through Checks (`d462952`).
- Task 087: Inspect a Candidate-owned Validation Run (`ad598c6`).
- Task 134: Remove incidental Git setup from SQLite tests (`5306e28`).

## Dependency graph

| Task | Capability | Blocked by |
| --- | --- | --- |
| 089 | Run configured Specialists | 096 |
| 092 | Recheck reviewer Findings without anchoring | 089, 096 |
| 098 | Publish one exact Candidate with recovery | 089, 092, 096, 133 |
| 101 | Reconcile owned PRs and clean completed Changes | 098, 133 |
| 105 | Migrate Submit to Change ownership | 089, 092, 096, 098, 101, 133 |
| 129 | Submit a Task-backed Change with no repository change | 096, 105 |
| 106 | Add Change inspection and migrate Task projections | 101, 105, 133 |
| 107 | Remove Task-owned implementation and delivery paths | 105, 106, 133 |
| 117 | Cancel Task-backed and taskless Changes | 101, 105, 133 |
| 130 | Launch a Change Implementer in Herdr | 133 |
| 123 | Ship the Change-centered manual workflow | 107, 117, 129, 130 |
| 125 | Produce an installable v1 package | 123 |
| 131 | Dogfood the first SQLite-tracked Change workflow | 125 |
| 126 | Publish But Why? to npm | 131 |

## Migration order

1. Task 084 expands Candidate-owned validation beside the existing Task-owned path.
2. Tasks 087, 096, 089, 092, 098, and 101 complete the Candidate-owned validation and delivery capabilities while Task 133 establishes prepared Change worktrees.
3. Task 105 composes those capabilities behind Change Submit without dual writes.
4. Task 106 migrates detailed inspection to Change commands and keeps Task projections concise.
5. Task 107 removes the replaced Task-owned writers, readers, routes, tables, and compatibility paths.
6. Tasks 117 and 130 complete cancellation, cleanup, Herdr launch, and handoff behavior before Task 123 ships the public workflow.

## Deferred

The following are not v1 contracts:

- Validation without a Change.
- Automatic Fixers and AFK workers.
- Needs Input, Hold, and Resume.
- Supervisor services and background PR watching.
- Automatic GitHub CI, review-comment, and merge-conflict remediation.
- Final Review and PR Writer agents.
- Token and monetary cost controls.
- Generic interactive-session providers.
- Batch Task creation.
- Tag-based or path-based conditional validation.

After Task 131 succeeds, reviewer evaluation work is created as SQLite Tasks rather than new Markdown issue drafts.
The first evaluation Tasks should cover one Acceptance fixture, one calibrated reviewer suite, and comparison of prompt or model reports.

## Planning status

- The active drafts have approved v1 boundaries.
- Exact interfaces, errors, limits, and edge cases are refined when each Task becomes ready to implement.
- Local and reversible implementation choices remain with execution.
