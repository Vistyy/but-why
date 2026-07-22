# V1 issue breakdown

## Release boundary

V1 is the Change-centered workflow defined by `docs/specs/taskless-changes-and-worktree-handoff.md`.
It ends when But Why? completes one real SQLite-tracked Task-backed Change and publishes the verified npm package.

## Can start immediately

- Task 135: Consolidate the source hierarchy and names.
- Task 155: Cover Validation Workspace recovery.
- Task 157: Cover Change Implement handoff errors.
- Task 117: Cancel Task-backed and taskless Changes.
- Task 129: Submit a Task-backed Change with no repository change.

## Dependency graph

| Task | Capability | Blocked by |
| --- | --- | --- |
| 135 | Consolidate the source hierarchy and names | None |
| 155 | Cover Validation Workspace recovery | None |
| 157 | Cover Change Implement handoff errors | None |
| 156 | Establish and verify the final quality gate | 135, 154, 155, 157 |
| 123 | Ship the Change-centered manual workflow | 107, 117, 129, 135 |
| 125 | Produce an installable v1 package | 123 |
| 131 | Dogfood the first SQLite-tracked Change workflow | 125 |
| 126 | Publish But Why? to npm | 131 |
| 138 | Establish post-publication compatibility policy | 126 |

## Migration order

1. Task 084 expands Candidate-owned validation beside the existing Task-owned path.
2. Tasks 087, 096, 089, 092, 098, and 101 complete the Candidate-owned validation and delivery capabilities while Task 133 establishes prepared Change worktrees.
3. Task 136 defines the Candidate validation service composition and production Layer graph before Task 105 composes it behind Change Submit.
4. Task 105 provides that graph to live Change Submit and consumes Candidate validation without dual writes.
5. Task 106 migrates detailed inspection to Change commands and keeps Task projections concise.
6. Task 107 removed the replaced Task-owned writers, readers, routes, compatibility paths, and historical SQLite migration chain in the implementation diff from baseline `bc6a1819457f469903094c6b85871565ec602372`.
7. Task 137 establishes the Effect SQL baseline and shared repository state foundation.
8. Task 148 established the blocking quality policy and advisory health reports.
9. Task 149 expands Effect-native storage beside the temporary synchronous contract.
10. Tasks 150 and 151 migrated Task, Change Start, and Candidate capture storage.
11. Task 152 migrated validation execution and history after Candidate capture.
12. Task 153 integrates Submit, publication, and reconciliation after Tasks 150 and 152.
13. Task 147 removed the temporary synchronous storage path after every production caller migrated.
14. Task 135 reorganizes the surviving modules and applies canonical names to the final hierarchy.
15. Tasks 154, 155, and 157 repair the remaining public behavior coverage before final gate verification.
16. Task 156 sets the achieved coverage floor and verifies the final gate from a clean locked-Nix checkout.
17. Task 117 completes cancellation and cleanup before Task 123 ships the public workflow.
18. After Task 126 publishes the package, Task 138 replaces the temporary unreleased-schema instruction with the post-publication compatibility policy.

## Independent test-execution workstream

Task 139 established framework-owned Effect execution through the complete Candidate validation test suite.
Tasks 142 and 144 completed the Effect test migration.
Task 143 enforces framework-owned Effect test execution.
Task 145 replaced global temporary-root cleanup through the established Effect test seam.
This workstream does not block Task 105.

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
