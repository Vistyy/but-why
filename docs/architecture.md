# Architecture

But Why is a repository-scoped modular monolith that validates submitted code against approved human intent.
This document defines stable ownership and dependency boundaries for contributors.
The [Context Map](../CONTEXT-MAP.md) and its linked contexts define canonical domain language and relationships.

## Domain ownership

[Task Intent](context/task-intent/CONTEXT.md) owns requested intent, Task Submission, dependencies, Task Reviews, and user-facing Task Lifecycle.
[Change Delivery](context/change-delivery/CONTEXT.md) owns code lineage, implementation, Candidates, validation, publication, reconciliation, and Change completion.
[Repository Runtime](context/repository-runtime/CONTEXT.md) owns Local Repository identity, Shared Repository State, configuration resolution, executable selection, preparation, and agent runtime configuration.

Task and Change coordination owns the optional one-to-one Task-to-Change link.
It supplies approved Task Context to linked Change Start, coordinates cancellation and exact merged completion, and joins Task and Change inspection.
A Change stores its initial Acceptance Context and does not read mutable Task Context after Start.
Changes linked to a Task and Changes without a Task use the same Change-owned validation and delivery path.

## Module boundaries

Task and Change modules own their workflows, invariants, cohesive persistence ports, and composition.
Task and Change coordination is an application boundary under `src/taskChange/` for operations that cross both domains.
An operation that crosses Task and Change state uses the coordination boundary rather than a hidden owner mutation.

CLI modules select operations and translate inputs and results.
They do not construct persistence Adapters or coordinate storage.
The command tree owns syntax, routing, and generated help, while the output boundary owns serialization.

Composition modules select concrete Adapters.
Domain workflow modules depend on owner-defined ports instead of concrete Adapters or composition modules.
Repository Runtime provides a scoped database capability rather than an Adapter registry or application container.

SQLite Adapters implement owner-defined persistence ports and own SQL and transaction mechanics.
Shared Agent Session execution owns Agent Session dispatch, Agent Continuation resume, Invocation settlement, Pi harness execution, transcript paths, and token evidence for Task Review, Change Validation, and Change-owned Stall Detection.
Repository Runtime supplies one Git Common Directory Agent Session transcript root to these workflows.
Task Intent and Change Delivery retain separate reviewer policy, prompts, output decoding, Findings, errors, and lifecycle behavior.
External execution, Git, GitHub, agent runtime, and disposable workspace behavior remain behind their applicable Adapter boundaries.

The enforced dependency zones and contributor checks are documented in [Tooling](tooling.md).

## Workflow boundaries

Ordinary Task Submission first selects the newest completed Review for the exact unchanged Task Context and direct Task Dependency set of a New Task.
Only a passed matching Review is reusable.
A reusable judgment returns before repository and reviewer preparation.
When no reusable judgment exists, ordinary Task Submission reviews one exact New Task proposal under its captured effective policy.
Finding-blocked and tooling-failed Reviews remain history and are not reusable judgments.
A later authorized submission of an unchanged New Task proposal runs a new Task Review.
Passing fresh completion or reuse moves the Task from New to Todo in the applicable Task Submission transaction.
Task Submission is the only supported operation that can approve an unlinked New Task.
Task Revision atomically returns an unlinked Todo Task to New while preserving its Context, dependencies, and Review history.

Change Start creates one Change and its Managed Worktree, optionally linked to an approved Task.
It directly reads Repo Config and repository reviewer instructions from the exact starting Change Base and stores one complete immutable Change policy.
Submission returns without validation when there is no changed Candidate.
Otherwise it selects an exact Candidate, uses only the stored Change policy, runs the fixed Validation Gate, and publishes the Candidate only with eligible evidence.
When the linked Change policy explicitly enables Stall Detection, Change Submit runs its Change-owned assessor after a qualifying Findings-blocked Validation Run without adding a Validation Phase or workspace access.
Candidate content is the Validation subject and never selects its own judgment policy.
Reconciliation observes publication and merge facts before coordination completes a Change and its linked Task atomically.

The fixed Validation Gate and project-owned execution boundary are defined by [ADR 0001](adr/0001-use-fixed-validation-gate-with-project-owned-execution.md).
Stall Detection receives only serialized Acceptance Context, Validation Run Finding evidence, exact input identities, and non-authoritative blocker history, and its Pi profile is restricted to the configured model and thinking level.
Exact Candidate provenance is defined by [ADR 0008](adr/0008-preserve-exact-candidate-provenance-through-submission.md).
Managed Worktree placement and recovery constraints are defined by [ADR 0007](adr/0007-place-managed-worktrees-in-a-visible-sibling-directory.md).

## State and interfaces

Shared Repository State is resolved through the Git Common Directory and shared by linked worktrees.
The globally installed `by` executable is the only supported CLI that opens or mutates live Shared Repository State.
Repo Config remains tracked at `.but-why/config.json`, while Global Config remains user-local.
Release-ready Shared Repository State starts from the single `0001_baseline` defined by [ADR 0009](adr/0009-use-forward-schema-migrations-before-release.md).
The baseline stores only current Task, Change, validation, publication, Stall Detection, and Agent Session facts, with public Task and Change IDs derived from the repository ID Prefix and SQLite integer identities.

The public configuration contract is documented in [But Why Config](public/config.md).
Cross-command serialization policy is documented in [CLI Output](cli-output.md) and constrained by [ADR 0011](adr/0011-use-json-as-the-only-cli-result-format.md).

The separate Task and Change coordination decision is recorded in [ADR 0012](adr/0012-separate-task-and-change-coordination.md), which supersedes [ADR 0006](adr/0006-use-domain-centered-modules-and-module-owned-persistence.md).
Other accepted decisions in `docs/adr/` constrain specific boundaries without being repeated here.
