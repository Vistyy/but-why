---
status: accepted
---

# Use Change as the validation and delivery owner

But Why? uses Change as the durable ownership center for code lineage, Candidates, Validation Runs, Findings, decisions, Needs Input, workspaces, and PR identity.
A Change may exist without a Task.
A Task owns requested intent, comments, approval, tags, and projected user-facing progress.
This separation makes standalone validation and Task-backed delivery use the same validation and publication model without turning Task state into a workflow command bus.

## Considered Options

- Keep validation and delivery owned by Task.
- Introduce a generic workflow or Run owner.
- Make Change the owner and link optional Task Acceptance Context.

## Consequences

- A repository branch has at most one open Change.
- A Candidate identifies an immutable comparison-base and head pair and retains the selected base reference and resolved target SHA as provenance.
- Validation Runs belong to Candidates and may optionally use Task-derived Acceptance Context.
- The Validation Gate remains read-only.
- Fresh Fixer Executions address Validation Findings and commit successor Candidates outside the Validation Gate.
- `by validate` validates without publishing.
- `by submit` validates and then publishes the exact eligible head.
- Task status projects approval and active Change facts rather than authorizing validation phases.
- Existing Task-owned validation and delivery code must migrate through Change and Candidate ownership.
- `docs/architecture.md` continues to describe the implemented v1 until that migration is complete.

This decision preserves fixed Validation Gate phases, repository-local state, Sandcastle execution, structured output, canonical Task Slugs, command-facing use cases, the domain-centered modular monolith, and the decision not to introduce a generic Run concept.
