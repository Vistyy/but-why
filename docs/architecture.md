# Architecture

But Why is a repository-scoped modular monolith that validates submitted code against approved human intent.
This document defines stable ownership and dependency boundaries for contributors.
The [Context Map](../CONTEXT-MAP.md) and its linked contexts define canonical domain language and relationships.

## Domain ownership

[Task Intent](context/task-intent/CONTEXT.md) owns requested intent, approval, dependencies, Task Reviews, and user-facing Task Lifecycle.
[Change Delivery](context/change-delivery/CONTEXT.md) owns code lineage, implementation, Candidates, validation, publication, reconciliation, and Change completion.
[Repository Runtime](context/repository-runtime/CONTEXT.md) owns Local Repository identity, Shared Repository State, configuration resolution, executable selection, preparation, and agent runtime configuration.

A Change can link one approved Task and capture its Acceptance Context.
Task-backed and taskless Changes use the same Change-owned validation and delivery path.

## Module boundaries

Task and Change modules own their workflows, invariants, cohesive persistence ports, and composition.
An operation that crosses Task and Change state belongs to the owner whose invariant requires the coordination.

CLI modules select operations and translate inputs and results.
They do not construct persistence Adapters or coordinate storage.
The command tree owns syntax, routing, and generated help, while the output boundary owns serialization.

Composition modules select concrete Adapters.
Domain workflow modules depend on owner-defined ports instead of concrete Adapters or composition modules.
Repository Runtime provides a scoped database capability rather than an Adapter registry or application container.

SQLite Adapters implement owner-defined persistence ports and own SQL and transaction mechanics.
Shared reviewer execution owns Reviewer Session compatibility, invocation, resume, restart, paths, permissions, session references, and execution evidence for Task Review and Change Validation.
Task Intent and Change Delivery retain separate policy, prompts, output decoding, persistence, Findings, errors, and lifecycle behavior.
External execution, Git, GitHub, agent runtime, and disposable workspace behavior remain behind their applicable Adapter boundaries.

The enforced dependency zones and contributor checks are documented in [Tooling](tooling.md).

## Workflow boundaries

Task Submission first selects the newest completed passed or Finding-blocked Review for the exact unchanged Task Context and direct Task Dependency set.
A reusable judgment returns before repository and reviewer preparation.
When no reusable judgment exists, Task Submission reviews one exact New Task proposal under its captured effective policy.
Passing fresh completion or reuse records the Task Approval transition from New to Todo in the applicable transaction.
Direct Task Approval remains a separate Operator action when no Task Review is active.

Change Start creates one Change and its Managed Worktree, optionally linked to an approved Task.
Submission returns without validation when there is no changed Candidate.
Otherwise it selects an exact Candidate, runs the fixed Validation Gate, and publishes the Candidate only with eligible evidence.
Reconciliation observes publication and merge facts before completing a Change and its linked Task.

The fixed Validation Gate and project-owned execution boundary are defined by [ADR 0001](adr/0001-use-fixed-validation-gate-with-project-owned-execution.md).
Exact Candidate provenance is defined by [ADR 0008](adr/0008-preserve-exact-candidate-provenance-through-submission.md).
Managed Worktree placement and recovery constraints are defined by [ADR 0007](adr/0007-place-managed-worktrees-in-a-visible-sibling-directory.md).

## State and interfaces

Shared Repository State is resolved through the Git Common Directory and shared by linked worktrees.
Repo Config remains tracked at `.but-why/config.json`, while Global Config remains user-local.
Shared Repository State uses the immutable forward migrations defined by [ADR 0009](adr/0009-use-forward-schema-migrations-before-release.md).

The public configuration contract is documented in [But Why Config](public/config.md).
Cross-command serialization policy is documented in [CLI Output](cli-output.md) and constrained by [ADR 0011](adr/0011-use-json-as-the-only-cli-result-format.md).

The domain-centered module and persistence decision is recorded in [ADR 0006](adr/0006-use-domain-centered-modules-and-module-owned-persistence.md).
Other accepted decisions in `docs/adr/` constrain specific boundaries without being repeated here.
