# Task Authority and Run Architecture PRD

## Problem Statement

But Why currently treats v1 state as repo-local SQLite state.

That is useful for local and private work, but it creates design pressure as soon as Tasks may come from different authorities.

A local SQLite Task can be authoritative for private work.

A remote GitHub or Linear Task should not depend on a local SQLite mapping that disappears in a fresh clone.

A read-only Jira issue should not be treated as Task Authority because But Why cannot safely write lifecycle or Task Context there.

The current direction also risks coupling Task content, Task Lifecycle, Runs, validation records, workspaces, Findings, and PR bookkeeping into one broad store.

That would make future remote Task Surfaces and workspace-scoped work harder to add.

The user wants to keep the current repo-scoped v1 validation path moving, while avoiding architectural corners that would make local, remote, and future multi-repo workflows fight each other.

## Solution

Clarify the domain model around Task identity, Task Authority, External References, Run, and Validation Run.

Keep local/private Tasks supported through SQLite.

Keep read-only Jira as an External Reference on a local But Why Task.

Allow future remote authoritative Tasks to use deterministic remote IDs instead of local SQLite-only aliases.

Separate Task authority from local execution history in code.

Use a TaskStore seam for Task content, Task Context, comments, lifecycle, branch binding, and authority-specific Task behavior.

Use a RunStore seam for durable execution history.

Use a ValidationRuns seam for validation-specific orchestration over TaskStore and RunStore.

Keep one SQLite file for now, but split the concepts and interfaces.

Keep v1 repo-scoped, but avoid assuming Task authority always lives in the current repo database.

This leaves room for a future workspace-level TaskStore that owns Tasks across multiple repositories while repo-level RunStore records local execution and validation history.

## User Stories

1. As a user, I want local private Tasks to keep working, so that I can use But Why without granting external tracker write access.

2. As a user, I want to create a local Task with no external tracker, so that small or private work does not need a Jira, GitHub, or Linear issue.

3. As a user, I want a local Task to reference a Jira issue, so that work context remains traceable without letting But Why write to Jira.

4. As a user, I want one Jira issue to reference many But Why Tasks, so that broad work can be split into repo-sized or implementation-sized units.

5. As a user, I want a But Why Task to have zero, one, or many External References, so that Task identity is not coupled to one tracker.

6. As a user, I want read-only external trackers to stay read-only, so that agents do not get unwanted write access to workplace systems.

7. As a user, I want read-only Jira to be context only, so that But Why lifecycle state remains clear and local.

8. As a user, I want local Tasks to use simple local IDs, so that private workflows stay easy to read and type.

9. As a user, I want future remote authoritative Tasks to use deterministic remote IDs, so that a fresh clone can find them without a local mapping database.

10. As a user, I want remote Task identity to survive SQLite loss, so that remote-backed work does not disappear with local cache state.

11. As a user, I do not want local aliases for remote Tasks initially, so that identity mapping stays simple.

12. As a user, I want branch and worktree names to be safe derived slugs, so that remote IDs with punctuation do not break Git or filesystem paths.

13. As a maintainer, I want Task IDs to be treated as opaque domain identifiers, so that future ID formats do not require broad code changes.

14. As a maintainer, I want Task parsing to live behind a Task ID seam, so that callers do not assume every Task ID is shaped like a local ID.

15. As a maintainer, I want Task Authority to be explicit, so that local, remote, and read-only-reference modes are not confused.

16. As a maintainer, I want TaskStore to own Task content and lifecycle behavior, so that Task authority can vary later.

17. As a maintainer, I want RunStore to own durable execution history, so that Runs are not tied to one Task authority.

18. As a maintainer, I want ValidationRuns to own validation start, so that submit code does not manually update Task state and create Run records.

19. As a maintainer, I want local SQLite to implement TaskStore and RunStore for v1, so that the current product path does not need a storage rewrite.

20. As a maintainer, I want one SQLite file to remain acceptable, so that local setup, transactions, and backup stay simple.

21. As a maintainer, I want separate store interfaces even when one SQLite file backs them, so that the code expresses authority boundaries clearly.

22. As a maintainer, I want local Task validation start to remain atomic when SQLite owns the Task, so that current behavior remains safe.

23. As a maintainer, I want remote Task validation start to avoid pretending it can be one local transaction, so that future remote behavior is honest.

24. As a maintainer, I want remote rollback and recovery deferred, so that v1 does not overbuild behavior for adapters that do not exist yet.

25. As a maintainer, I want partial remote-start failures to become structured errors later, so that recovery can be explicit instead of hidden.

26. As a maintainer, I want Run to mean generic execution history, so that future But Why loops can share durable run records.

27. As a maintainer, I want Validation Run to carry validation-specific rules, so that commit-bound validation semantics do not pollute every Run.

28. As a maintainer, I want Validation Run to validate one submitted commit, so that v1 validation remains precise and reproducible.

29. As a maintainer, I want Task Context snapshots for Validation Runs, so that old validation history remembers the intent it judged.

30. As a maintainer, I want Findings to remain attached to Validation Runs, so that validation blockers stay tied to the judged commit and context.

31. As a maintainer, I want PR publication state to be local execution state, so that losing local state only loses local history unless the PR can be rediscovered.

32. As a maintainer, I want future PR recovery rules to be explicit, so that local DB loss after PR creation has a known contract.

33. As a user working in one repository, I want repo-scoped validation to remain the v1 path, so that current implementation work stays focused.

34. As a user working in a multi-root workspace, I want the architecture not to block a future workspace-level TaskStore, so that multi-repo work can be coordinated later.

35. As a user working across repositories, I want a future workspace Task authority to coordinate many repo execution records, so that cross-repo work does not require duplicated parent Tasks in every repo.

36. As a user working across repositories, I want each repository to keep repo-specific validation and PR behavior, so that checks, branches, worktrees, and PRs remain natural to that repo.

37. As a maintainer, I want workspace support to avoid two competing Task authorities, so that workspace state and repo state do not disagree about Task lifecycle.

38. As a maintainer, I want future workspace mode to be additive, so that repo-scoped v1 does not need to be discarded.

39. As an implementing agent, I want clear seams for TaskStore, RunStore, and ValidationRuns, so that I know where changes belong.

40. As a reviewer, I want module boundaries to reflect Task authority and Run history, so that architecture violations are easy to spot and automate.

## Implementation Decisions

- Task is a But Why work unit, not an external ticket, issue, or card.

- External Reference is a link from a Task to another system's work item.

- External References do not define Task identity.

- A Task can have zero or more External References.

- Many Tasks can reference the same external tracker item.

- Task Authority is the place responsible for durable Task content and lifecycle state at a given time.

- A read-only external tracker cannot be Task Authority.

- Work Jira usage is modeled as local authoritative Tasks with optional Jira External References.

- Local authoritative Tasks keep the local ID format.

- Future remote authoritative Tasks use deterministic remote IDs.

- Local aliases for remote Tasks are rejected for the early design.

- SQLite may cache or index remote data later, but it must not become the hidden authority for remote Task identity.

- Task IDs are treated as opaque identifiers by most callers.

- Branch names, worktree names, temp refs, artifact paths, and other filesystem or Git names should use safe derived slugs.

- TaskStore is the seam for Task content, Task Context, comments, lifecycle transitions, branch binding, and authority-specific Task behavior.

- RunStore is the seam for durable execution history.

- ValidationRuns is the domain seam for validation-specific orchestration.

- ValidationRuns owns validation start.

- ValidationRuns.start coordinates Task state changes, Run creation, Validation Run creation, and branch binding where needed.

- SQLite remains the only implementation during the first split.

- One SQLite file may back both TaskStore and RunStore.

- Separate store interfaces are still required even when one SQLite file backs them.

- Local SQLite validation start may remain one local transaction.

- Remote authoritative validation start must not assume local transaction semantics.

- Remote rollback and recovery behavior is deferred until a remote Task Surface exists.

- Run is a generic durable execution record for a Task.

- Validation Run is a Run that validates one submitted commit SHA against Task Context through the Validation Gate.

- Validation-specific phases, rounds, Findings, workspace setup, tooling errors, and PR outcomes belong to Validation Run behavior.

- Validation Runs should store or reference the Task Context snapshot they judged.

- The first implementation should split the current broad state seam into narrower concepts without changing user-facing behavior.

- Future remote Task Surface adapters should replace or wrap TaskStore behavior without replacing local RunStore behavior.

- Future workspace support should prefer one workspace-level Task authority over both workspace Tasks and repo Tasks owning lifecycle independently.

- Repo-scoped validation remains v1 behavior.

- Multi-repo workspace support is not implemented in this PRD.

- The architecture should avoid assumptions that Task authority always lives in the current repository database.

## Testing Decisions

- The highest test seam for current behavior remains the CLI behavior observed by users and agents.

- Refactors that split TaskStore, RunStore, and ValidationRuns should preserve existing CLI output, errors, and durable behavior.

- Store seam tests should cover behavior through public store interfaces, not raw SQLite details.

- ValidationRuns tests should cover validation start as one domain operation.

- Local SQLite tests should prove validation start remains atomic for local authoritative Tasks.

- Task ID tests should prove callers can handle opaque Task IDs and do not rely on local-only ID shape.

- Slug tests should prove local and remote Task IDs can produce safe branch, ref, path, and worktree names.

- Validation Run tests should prove validation-specific records remain tied to the submitted commit.

- Task Context snapshot tests should prove a Validation Run can identify the Task Context it judged.

- Future remote Task tests should prove fresh local state can operate from deterministic remote Task identity.

- Future workspace tests should prove workspace Task authority can provide Task Context while repo RunStore records repo-specific execution.

- Static architecture checks should guard the intended boundaries after the seams exist.

- Behavior tests should not assert implementation file structure.

- Architecture tests should not replace CLI behavior tests.

## Out of Scope

- Implementing GitHub Issues, Linear, Jira, or Kanboard Task Surface adapters.

- Implementing remote sync, reindex, stale cache, conflict handling, or offline remote behavior.

- Giving agents write access to Jira.

- Adding local aliases for remote Tasks.

- Moving local state out of the current SQLite file.

- Changing existing v1 CLI behavior.

- Changing existing Task lifecycle states.

- Changing existing local Task ID format.

- Implementing workspace-level TaskStore.

- Implementing multi-repo validation.

- Implementing refinement or implementation loops.

- Designing remote rollback or recovery in detail.

- Publishing or merging PRs differently.

## Further Notes

This PRD is mostly architectural enablement.

The goal is to make the next storage and lifecycle refactors point in the right direction without adding remote or workspace features yet.

The design keeps local/private work useful while leaving room for shared remote Task Surfaces and future workspace-scoped coordination.

The most important rule is to avoid confusing Task authority with local execution history.
