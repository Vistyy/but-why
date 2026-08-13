# First release planning index

**Status:** Active exploration.
This file is temporary planning context and is not implementation authority.

**Removal condition:** Remove this file after every approved implementation outcome is recorded in the smallest applicable SQLite Tasks, accepted architectural decisions are recorded in their authoritative artifacts, and remaining release operations are completed or captured in an approved procedure.

## Intended outcome

But Why will have a first stable public release identified as `0.1.0`.
The npm package remains `but-why`, the executable remains `by`, and the release uses the normal `latest` distribution tag.
Publication is manual after verification of the exact package artifact.

## Planning method

Complete required review and design before authoring implementation Tasks.
Tasks describe bounded supported outcomes rather than assigning unresolved design to an Implementer.
Use the smallest coherent vertical Tasks that leave the repository safe and supported.
Keep external release operations separate from implementation Tasks when they do not produce a repository Candidate.

The first-release architecture remains an opinionated modular monolith.
It does not add speculative hooks, a generic workflow engine, a public SDK, plugin infrastructure, or unimplemented provider systems.
It keeps external mechanisms local so a credible future extension replaces or deepens one owning module rather than requiring changes throughout the system.

## Planning records

### Architecture extension readiness

[`architecture-extension-readiness.md`](architecture-extension-readiness.md) defines the architectural review criteria and the intended separation between domain operations, policy, Adapters, and possible future hooks.
It owns the cross-cutting decision to preserve extension locality without implementing speculative extension machinery.

### Task Backend boundary

[`task-backend-boundary.md`](task-backend-boundary.md) owns Task authority, the SQLite first-release Adapter, and the unresolved coordination between Task and Change state.
It keeps Linear and GitHub Issues as possible future backends without implementing either.

### Agent Session and execution

[`agent-session-execution.md`](agent-session-execution.md) owns the shared mechanics required by Task Review, Change reviewers, and the Publication Agent.
It keeps role policy and outcomes domain-owned and does not claim cloud or location-transparent execution.

### Candidate Publication presentation

[`candidate-publication-presentation.md`](candidate-publication-presentation.md) owns Publication Agent behavior, generated pull request presentation, pending and confirmed presentation recovery, and Submission Workspace behavior.
It consumes the shared Agent Session and execution capability.

### Released baseline and state cutover

[`release-baseline-cutover.md`](release-baseline-cutover.md) owns the reviewed `0001_baseline`, retirement and archive of prerelease state, migration compatibility classification, and the trusted-executable cutover procedure.
It consumes accepted persistence requirements from the Task Backend, Agent Session, and Candidate Publication plans.

### Release readiness

[`release-readiness.md`](release-readiness.md) owns global npm installation, Pi setup, package resources, licensing, public documentation, CI, repository controls, artifact verification, and manual publication operations.

## Dependency direction

```text
Architecture extension readiness
  |
  +--> Task Backend boundary -----------+
  |                                     |
  +--> Agent Session and execution --+  |
                                     |  |
                                     v  v
                     Candidate Publication presentation
                                     |
                                     v
                      Released baseline and state cutover
                                     |
                                     v
                             Release readiness
```

Release-readiness work that does not depend on the final baseline may proceed independently after its outcome is approved.
The diagram describes planning dependencies, not automatically authorized Task Dependencies.
Actual Task Dependencies must be established from the accepted implementation outcomes.

## Deliberately deferred areas

The first release does not include:

- Linear or GitHub Issues Task Backends.
- A second headless Agent Harness.
- Cloud, cross-machine, containerized, or sandboxed execution.
- A second Publication Target.
- Arbitrary lifecycle hooks or a generic validation pipeline.
- A public SDK.
- Plan authority or Planning Review.
- A supervisor, Global Watcher, automatic implementation, or unattended workflow.
- Monetary cost accounting.
- Generic remote Shared Repository State.

These exclusions do not assert that the future capabilities are unsupported architectural goals.
They prevent the first release from inventing interfaces before a concrete implementation establishes their contracts.

## Task authoring gate

Do not record first-release implementation Tasks until the applicable planning record has:

- An approved observable outcome.
- Resolved choices that affect supported behavior or Task boundaries.
- A practical verification path.
- Identified actual dependencies on other outcomes.

Task Recording Authorization, Task Submission Authorization, and Implementation Authorization remain separate explicit Operator decisions.

## Authorization status

No first-release implementation Task has been authorized from these planning records.
No implementation, publication, external GitHub configuration, Task Recording, Task Submission, Change Start, or Implementation Authorization is granted by this index.
