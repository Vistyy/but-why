# Open questions

This file tracks only unresolved product and architecture questions.

Do not add backlog, follow-up work, or completed decisions here.

Settled decisions belong in `docs/architecture.md` or `docs/adr/`.

## Sandcastle

Open questions:

- What Pi token usage does Sandcastle return for the selected runtime and model?
- Does v1 advertise Podman support?
- If v1 advertises Podman support, what smoke test is required?

## Task readiness and orchestration

We need to decide how task readiness, refinement, implementation, and escalation should work after the validation-focused v1 path.

Open questions:

- How should undercooked tasks be detected before implementation?
- Should refinement be a state, a tag, a command, or a separate loop?
- How should users handle centralized escalation across many tasks?
- Should `by` orchestrate implementation, or should agents use `by` commands directly?

This must stay distinct from the Validation Gate, which validates a completed submission.

## Task metadata, tags, and routing

V1 supports only the built-in `afk` tag for automatic pickup.
Lifecycle control, dependencies, and Task Queue Order remain first-class behavior rather than tags.

Later versions may add classification or routing only when a concrete capability defines its behavior.
Open questions include whether categories should select validation policy or map to external Task Surfaces.

## Task relationships and dependencies

Task Dependencies are directed prerequisites.
They do not block Task editing or Approval, and every prerequisite must be done before the dependent Task may start manually or automatically.
A dependent Task's prerequisite list becomes fixed when that Task starts.
A cancelled prerequisite remains unsatisfied, and a cycle is rejected atomically with the complete cycle shown in the error.

Open questions:

- What relationship types exist beyond Task Dependencies?
- Are relationships local-only, or must they map to future external Task Surfaces?


## Validation phase configuration

V1 uses fixed phases instead of a generic CI pipeline.

The remaining config shape is open for whether check commands should support argv arrays after Sandcastle supports argv-native execution.

The config should stay small and should not become a generic workflow language.

## Reviewer role set

V1 supports explicitly configured Specialist Reviewers, one always-on Final Reviewer, and an Acceptance Reviewer only when Acceptance Context exists.
`by init` configures no Specialists by default.
Specialists require repository-owned instruction files, while Final and Acceptance Review use built-in prompts unless Repo Config supplies overrides.
The exact built-in prompt contents remain owned by their implementation Tasks and reviewer evaluation fixtures.

## GitHub readiness details

V1 publishes one non-draft PR for one locally owned Change and treats GitHub as the authority for required checks and mergeability.
A PR is ready only when it is open, non-draft, mergeable, at the expected base and exact validated head, all GitHub-required checks pass, and no active requested-changes review blocks it.
Normal comments do not block readiness, and no comment or review text becomes automatic code-writing input.
But Why? code records Needs Input when trusted GitHub facts show an active requested-changes review, external head push, base-target retargeting, or unmerged closed PR with no approved automatic continuation.
An opt-in PR Readiness Fixer may address only failed required CI or a confirmed merge conflict on an exact owned PR through the hardened v1 sandbox boundary.
The polling timeout and retry defaults remain owned by the PR watching Task.

## Agent profiles and Sandcastle mapping

V1 executes only Pi Agent Profiles through Sandcastle.
Additional runtimes become later vertical capabilities.

The remaining Pi adapter details are:

- environment variables
- session storage
- log locations
- permissions

## Token accounting

V1 records tokens, not dollar costs.

We still need to verify how the Pi Sandcastle adapter maps available usage into the canonical buckets:

```text
inputTokens
cachedInputTokens
outputTokens
totalTokens
```

## Observability beyond local records

V1 stores runs, rounds, logs, artifacts, findings, and token usage locally.

We still need to decide whether later versions should export traces to:

- OpenTelemetry
- Langfuse
- Braintrust
- another existing observability tool

No custom dashboard should be built early.

## Stronger automatic-writing isolation

V1 uses a hardened Sandcastle Docker or rootless Podman provider as an explicit opt-in trade-off for unattended code writing.
A future security slice may add an isolated Sandcastle provider backed by OpenShell or Gondolin after a spike proves Pi session transfer, private workspace synchronization, credential proxying, deny-by-default network policy, cancellation, resource limits, and Candidate export.
Docker Sandboxes and gVisor remain comparison points rather than selected dependencies.

## Supervisor terminal UI

A future terminal UI may connect to the headless user-level Supervisor to inspect repositories, Task queues, worker health, activity, and blockers and to request Task reordering, start, resume, or cancellation actions.
The terminal UI is a separate client, so closing it never stops Supervisor or worker automation.
Design begins only after the worker protocol, health model, Task queue, and structured inspection commands are stable.
The exact interaction model, command name, cross-repository views, and write operations remain open.

## Coordinator Agent

A future first-party Coordinator Agent may provide one conversational place to refine, order, dispatch, and monitor work across registered repositories.
It is a client of durable Task, Change, validation, fleet-reporting, and targeted-dispatch interfaces rather than an owner of workflow state or part of the Supervisor.
This capability begins only after single-repository automation, the headless Supervisor, targeted dispatch, and bounded fleet reporting are stable.
Its agent harness, conversation surface, authority limits, and relationship to the terminal UI remain open.
