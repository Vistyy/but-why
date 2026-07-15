# Task Dependency Graph

This file tracks remaining Task ordering only.

Detailed Task drafts live under `docs/issues/`.
Every Task is a flat vertical slice or an explicit expand, migrate, or contract stage.
The target architecture is approved by ADRs under `docs/adr/` and specified by `docs/prds/change-centered-validation-prd.md`.
Done Tasks are omitted from this graph.

## Can start immediately

- `077-approve-task-intent.md`
- `078-manage-built-in-task-tags.md`
- `084-validate-standalone-candidate-through-checks.md`

## Flat Task graph

| Task | Capability | Blocked by |
| --- | --- | --- |
| 077 | Approve Task intent | None |
| 078 | Manage built-in Task tags | None |
| 079 | Manage the Task dependency graph | 077 |
| 080 | Order and reorder Tasks | 077 |
| 081 | Show the actionable Task dashboard | 077, 079, 080 |
| 082 | Inspect a bounded dependency neighborhood | 079 |
| 083 | Start an eligible Task-backed Change manually | 077, 079 |
| 084 | Expand: validate a standalone Candidate through checks | None |
| 085 | Recover interrupted standalone validation | 084 |
| 086 | Validate with allowlisted local files | 085 |
| 087 | Inspect one Candidate-owned Validation Run | 084 |
| 088 | List bounded Candidate validation history | 087 |
| 089 | Run one configured Pi Specialist | 085, 086 |
| 090 | Run unfinished Specialists in parallel | 089 |
| 091 | Fix check Findings with Pi | 085, 086 |
| 092 | Verify one Specialist revision | 089, 091 |
| 093 | Coordinate Specialist fixing batches | 090, 092 |
| 094 | Carry eligible Specialist completion forward | 089, 091 |
| 095 | Complete Final Review | 093 |
| 096 | Add Acceptance Review | 083, 095 |
| 097 | Resume a Task-backed Change | 083, 084, 091 |
| 098 | Publish one exact eligible Candidate | 095 |
| 099 | Recover an ambiguous publication result | 098 |
| 100 | Compose standalone validation and publication | 086, 095, 099 |
| 101 | Reconcile one owned PR once | 098 |
| 102 | Watch owned PRs over time | 101 |
| 103 | Fix failed GitHub CI on an owned PR | 095, 100, 101, 130 |
| 104 | Route requested PR changes to Needs Input | 101 |
| 105 | Migrate Task-backed submission | 096, 097, 100 |
| 106 | Migrate Task inspection | 088, 101, 105 |
| 107 | Contract Task-owned validation and delivery | 105, 106 |
| 108 | Implement one eligible AFK Task | 078, 079, 080, 083, 091 |
| 109 | Deliver an implemented AFK Task | 100, 103, 104, 108, 131 |
| 110 | Register a repository with the Linux Supervisor | 109 |
| 111 | Wake a registered repository worker | 110 |
| 112 | Recover interrupted repository work | 102, 111 |
| 113 | Isolate unhealthy repositories | 112 |
| 114 | Show Change activity | 088, 101, 112 |
| 115 | Show execution and reviewer usage | 091, 095 |
| 116 | Show Supervisor worker health | 113 |
| 117 | Cancel a Task and linked Change durably | 079, 085 |
| 118 | Stop active local work after cancellation | 092, 108, 111, 117 |
| 119 | Close an owned PR after cancellation | 099, 101, 117 |
| 120 | Evaluate one Specialist fixture | 089 |
| 121 | Run one calibrated reviewer suite | 120 |
| 122 | Compare two reviewer suite reports | 121 |
| 123 | Teach the installed manual workflow | 106, 114, 115, 119, 128, 129, 130, 131 |
| 124 | Teach AFK and Supervisor automation | 111, 116, 123 |
| 125 | Produce a versioned release candidate | 123, 124 |
| 126 | Publish `but-why` to npm | 125 |
| 127 | Verify the v1 release surface | 116, 119, 122, 126 |
| 128 | Hold and resume Task progress | 081, 097, 101, 118 |
| 129 | Complete an approved Task with no change | 079, 083, 101, 118 |
| 130 | Harden the automatic code-writing sandbox | 091, 108 |
| 131 | Fix merge conflicts on an owned PR | 095, 100, 101, 130 |

## Expand, migrate, contract

1. Task 084 expands Candidate-owned validation beside the unchanged legacy Task-owned submit path.
2. Task 105 migrates Task-backed submission without dual writes.
3. Task 106 migrates Task inspection to Change-owned facts.
4. Task 107 removes the old writers, readers, tables, routes, compatibility paths, and data.

## Deferred

- Planning-phase Intent Review starts after Planning Phase and Task-readiness architecture are approved.
- Proven orphaned Validation Workspace reclamation starts after a reliable process-liveness or sandbox-resource identity exists.
- A Supervisor terminal UI starts after worker health and structured inspection are stable.
- A Coordinator Agent starts after targeted dispatch and bounded fleet reporting are stable.
- Additional agent runtimes, remote Candidate adoption, targeted dispatch, and an optional global worker cap remain later vertical capabilities.

## Planning status

- Tasks 077 through 131 are persisted drafts with approved vertical boundaries.
- Each draft must be grilled before implementation to replace its open-decision section with an implementation-ready contract.
- Completed Tasks 049 through 051 remain the foundations for Agent Profiles and Change and Candidate capture.
