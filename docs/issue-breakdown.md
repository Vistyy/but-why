# V1 issue breakdown

## Release boundary

V1 is the manual Task workflow defined by `docs/prds/change-centered-validation-prd.md`.
It ends when But Why? completes one real SQLite-tracked dogfood Task and publishes the verified npm package.

## Can start immediately

- Task 087: Inspect a Candidate-owned Validation Run.
- Task 096: Run built-in Acceptance Review.

## Completed

- Task 083: Start a Task in a managed worktree (`3b465b8`).

## Dependency graph

| Task | Capability | Blocked by |
| --- | --- | --- |
| 089 | Run configured Specialists | 096 |
| 092 | Recheck reviewer Findings without anchoring | 089, 096 |
| 098 | Publish one exact Candidate with recovery | 089, 092, 096 |
| 101 | Reconcile an owned PR during Submit | 098 |
| 105 | Compose and migrate Task Submit to Candidate ownership | 083, 087, 089, 092, 096, 098, 101 |
| 129 | Submit a Task with no repository change | 096, 105 |
| 106 | Migrate Task inspection to Change-owned facts | 087, 101, 105 |
| 107 | Remove Task-owned validation and delivery | 105, 106 |
| 117 | Cancel a Task and its owned PR | 101, 105 |
| 123 | Ship the manual Task workflow | 107, 117, 129 |
| 130 | Launch a Task Implementer in Herdr | 083, 117, 123 |
| 125 | Produce an installable v1 package | 130 |
| 131 | Dogfood the first SQLite-tracked Task | 125 |
| 126 | Publish But Why? to npm | 131 |

## Migration order

1. Task 084 expands Candidate-owned validation beside the existing Task-owned path.
2. Tasks 087, 096, 089, 092, 098, and 101 complete the new internal capabilities while the public command remains green.
3. Task 105 composes those capabilities and migrates public Task Submit without dual writes.
4. Task 106 migrates Task inspection.
5. Task 107 removes the old writers, readers, routes, tables, and compatibility paths.

## Deferred

The following are not v1 contracts:

- Standalone validation.
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

- These 22 drafts have approved v1 boundaries.
- Exact interfaces, errors, limits, and edge cases are refined when each Task becomes ready to implement.
- Local and reversible implementation choices remain with execution.
