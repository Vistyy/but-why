# Architecture extension readiness plan

**Status:** Paused.
The prior planning direction is under reconsideration because Task Intent may move to a separate product.
Do not use this plan as current planning direction or implementation authority.

**Removal condition:** Remove this file after its accepted architectural constraints are implemented or recorded in the applicable current architecture authority, and all resulting implementation outcomes are recorded in SQLite Tasks.

## Outcome

But Why remains an opinionated task-based product while its major workflows keep external mechanisms and infrastructure knowledge local.
A credible future extension should replace or deepen one owning module rather than require changes across the complete system.
The first release does not add speculative hooks, a generic workflow engine, a public SDK, multiple providers, or plugin infrastructure.

## Current assessment

The current modular-monolith direction is suitable and should remain.
Task Intent and Change Delivery own domain workflows and invariants.
CLI modules route supported operations and translate results.
Composition modules select concrete Adapters.
Domain workflows depend on owner-defined ports instead of concrete Adapters.
SQLite Adapters own SQL and transaction mechanics.

The architecture is not required to make an unimplemented extension require no refactoring.
It must preserve locality so later variation does not spread implementation-specific knowledge through unrelated workflows.

## Operation structure

Each supported operation follows this structure:

```text
CLI or future application caller
  -> domain-owned application operation
     -> domain policy and coordination
        -> narrow external-mechanism ports
```

The domain-owned operation defines the meaning, authority, postconditions, recovery, and structured result.
An Adapter implements an external mechanism without redefining that meaning.
A policy can vary how a judgment is reached while preserving the operation's postconditions.
A future hook can make a bounded contribution before or after an operation without replacing its meaning.

The first release does not add hook registration.
Keeping one workflow owner and one application entry point for each operation is sufficient preparation for later hooks.

## Architectural constraints

- Keep one domain-owned application entry point for each supported operation.
- Keep lifecycle transitions and postconditions inside the owning operation.
- Pass resolved policy and configuration into workflows rather than reading configuration throughout domain code.
- Keep Pi, Herdr, local process, local path, GitHub, and other implementation-specific facts inside their applicable infrastructure or integration modules unless the domain contract requires the fact.
- Use cohesive persistence operations that preserve domain invariants rather than generic repositories or direct table access by callers.
- Keep uncertain external mutation and reconciliation with the owner that initiated the mutation.
- Add a seam only for a concrete variation, current second consumer, external boundary, lifecycle difference, isolation requirement, or verification replacement.
- Do not add generic workflow, step, hook, plugin, provider registry, owner, or run concepts without a current supported need.
- Do not expose storage mutation primitives as a future SDK contract.

## Current extension assessment

### Task Backend

Task storage is the most material unresolved boundary.
A `TaskPersistence` port exists, but Change Start, cancellation, and merged Change completion currently coordinate Task and Change rows through shared SQLite transactions.
Replacing only `TaskPersistence` would not replace Task authority.

The first release should define Task Backend ownership and the local coordination boundary without implementing Linear, GitHub Issues, offline synchronization, or a generic remote-resource framework.
This work is owned by `task-backend-boundary.md`.

### Agent execution

Pi reviewer execution, Herdr Interactive Sessions, local commands, and local workspaces currently use different lifecycle contracts.
The current architecture is suitable for another local Adapter but is not location-transparent.
Remote or cloud execution would also require repository transfer, authority, credentials, cancellation, result settlement, and uncertain-dispatch reconciliation.

The first release should share only mechanics and evidence required by current Task Review, Change reviewers, and the Publication Agent.
It should keep harness-specific and local-execution knowledge local without claiming a cloud protocol.
This work is owned by `agent-session-execution.md`.

### Command execution and isolation

Repository Preparation, Checks, and agent processes currently execute locally.
Their execution implementations should remain local to their owning modules.
A future sandbox, container, remote worker, or SaaS execution mechanism can justify a stronger execution contract when its exact authority and transfer model are known.
The first release does not create one generic command-and-agent execution backend.

### Interactive Session Host

`InteractiveSessionHost` is an existing seam with Herdr as the current Adapter.
Another visible host may implement that contract later.
A background Implementer or cloud agent has a different lifecycle and should use shared Agent Execution mechanics only where the contracts genuinely overlap.
The first release does not merge visible interactive hosting and headless execution into one shallow interface.

### Publication Target

GitHub mechanics should remain localized behind Change-owned publication integrations.
Candidate identity, validation eligibility, uncertain mutation recovery, and completion evidence remain Change Delivery policy.
A local, no-publication, GitLab, or other target will require an explicit definition of publication and completion before a common target interface can be finalized.
The first release does not pretend that GitHub pull request facts are already universal.

### Validation configuration

The Validation Gate remains fixed.
Repositories can configure Prepare, Checks, Acceptance Review behavior, Specialists, Agent Profiles, and execution resources within supported slots.
The first release does not add arbitrary phases, step types, or lifecycle hooks.
A later need for several Task Reviewers or different judgment aggregation should be modeled as bounded approval policy rather than redefining Task Submission.

### Shared Repository State

SQLite Shared Repository State remains the supported operational-state mechanism for the first release.
The schema represents the current domain rather than plugins or hypothetical backends.
External Task authority is a separate decision from Change, execution-evidence, and recovery state.

### CLI and future SDK

The agent-first, non-interactive `by` CLI remains the public application interface.
A future SDK may call the same domain-owned application operations.
The first release does not publish an SDK or expose direct persistence primitives.

## Architecture review method

Before finalizing each release plan:

1. Trace one representative operation from CLI entry through domain workflow, persistence, and external effects.
2. Name the owner of each invariant and external mutation.
3. Identify implementation-specific knowledge that crosses the owner's boundary.
4. Change only leaks that would make a credible future replacement cross unrelated modules.
5. Confirm that the supported behavior remains verifiable through the application operation.

## Plan boundaries

The first-release work is divided among:

- `task-backend-boundary.md` for Task authority and Change coordination.
- `agent-session-execution.md` for shared Agent Session and Agent Execution behavior.
- `candidate-publication-presentation.md` for Publication Agent presentation and GitHub mutation recovery.
- `release-baseline-cutover.md` for the released SQLite baseline and prerelease-state cutover.
- `release-readiness.md` for installation, Pi setup, public packaging, CI, artifact verification, and publication operations.

## Authorization status

No implementation is authorized by this plan.
No Task Recording, Task Submission, Change Start, or Implementation Authorization has been granted.
