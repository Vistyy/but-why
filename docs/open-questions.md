# Open questions

## Task workspace abstraction

We still need to decide how task workspaces are created and managed.

Options include:

- Worktrunk-style branch and worktree lifecycle
- Treehouse-style warmed disposable worktrees plus later branch creation
- custom minimal git orchestration
- agent-managed raw git with guardrails

The user-facing object should be a task, not a branch or worktree.

## Intent binding

We need a simple way to bind approved context to a validation run.

The gate should not infer intent from the implementing agent.

The gate should not be tightly coupled to Lavish.

The likely model is an explicit `IntentRef` that points to approved context artifacts.

## Sandcastle dependency risk

Sandcastle may save a lot of code.

It is also young and pre-1.0.

We need a spike before depending on it heavily.

The dependency should sit behind `ExecutionProvider`.

## Dagger versus repo scripts

Repo scripts are the simplest check runner for v1.

Dagger may become useful if we want reproducible local and CI check environments.

We should not require Dagger until normal scripts become painful.

## Effect

Effect may reduce cognitive load in orchestration code.

It is most useful for:

- typed errors
- retries
- timeouts
- resource cleanup
- dependency injection

It should not be used for pure policy functions if plain TypeScript is clearer.

## PR babysitting scope

We need to decide how much PR babysitting belongs in early versions.

Minimum:

- create or update PR
- watch CI
- surface failure

Later:

- diagnose CI failures
- run fixer agents
- rebase or merge latest main
- resolve mechanical conflicts
- ask user on semantic conflicts

## Observability vendor

We want traces, costs, artifacts, and run history.

We do not want to build a dashboard early.

Candidates:

- OpenTelemetry
- Langfuse
- Braintrust
- local SQLite plus artifact files

## Agent role evals

Reviewer and fixer agents need evals from the beginning.

The main unresolved question is how formal those evals need to be in v1.

At minimum, we need golden fixtures for intent plus diff plus expected findings.
