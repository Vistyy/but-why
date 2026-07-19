# Open questions

This file tracks unresolved product and architecture questions outside the reduced manual v1 contract.
Settled v1 behavior belongs in the active PRD, glossary, ADRs, and Task drafts.

## Reviewer evaluation

After v1 dogfooding, create SQLite Tasks for:

- Evaluating one Acceptance Reviewer fixture.
- Running a calibrated suite across Acceptance and configured Specialists.
- Comparing prompt, model, and configuration reports over fixed fixtures.

The suite should measure expected Finding detection, clean-result accuracy, and unsupported Findings without becoming a release blocker before the first manual workflow ships.

## Specialist scheduling

Specialists run sequentially today.
Parallel scheduling may be reconsidered after real-use evidence, with explicit design for workspace isolation, resource limits, failure collection, cancellation, and deterministic result ordering.

## Sandcastle structured reviewer output

V1 keeps one local output-correction resume because Sandcastle `Sandbox.run()` does not expose structured-output retry.
Future work may upgrade or extend `Sandbox.run()` to support structured output and retry handling.
But Why? can then remove the local correction path and delegate this behavior to Sandcastle.

## Agent usage and cost

Sandcastle does not currently return trustworthy Pi token or monetary usage.
Future work should record per-session and per-Task usage and distinguish unknown from zero.
Once trustworthy usage exists, decide whether user-defined spend limits are required for automatic work.

## Task readiness

Future planning may add an optional Task Preflight for missing prerequisites or a disposable feasibility prototype for uncertain technical assumptions.
These capabilities should be driven by dogfooding evidence and remain separate from completed-code validation.

## Automatic implementation and fixing

Future versions may add AFK Implementers, automatic Fixers, and a code-owned graceful stop when no approved automatic path can continue.
That work must define process ownership, cancellation, workspace fencing, cost protection, recovery, and security from observed interactive-session behavior.

A future Needs Input state remains an orchestration-owned circuit breaker rather than an agent request.
Agents should make and record reasonable decisions while But Why? code may stop only for a known mechanical blocker with preserved evidence, exhausted recovery, and a resumable checkpoint.

## GitHub automation

V1 refreshes PR facts only through Submit and never treats GitHub-authored text as implementation instructions.
Future work may consider background watching, webhooks, CI remediation, requested-change workflows, and merge-conflict remediation after their authority and prompt-injection boundaries are redesigned from evidence.

Automatic PR writing should remain limited to failed required CI or a confirmed conflict on an exact owned PR and expected SHA.
Comments, reviews, titles, and descriptions must not become agent instructions.
The agent should receive no GitHub credentials or direct push ability, while But Why? revalidates and performs an expected-SHA push and the human retains merge authority.
Conflict remediation should merge the latest base into the PR branch rather than rebase or force-push, then run the complete gate again.

## Interactive sessions

V1 may open a Herdr child workspace and fresh Pi Implementer as a temporary interactive workflow.
The final Global Config key is chosen during that implementation Task.
Future work may add another provider only after a second implementation proves a real shared interface.

## Conditional validation

Future configuration may select Checks or Specialists from changed paths, Task metadata, or other trusted facts.
V1 uses only the fixed changed-code gate and Acceptance-only no-change path.
A later design should add named conditions rather than a generic workflow language.

## Stronger isolation

Read-only validation continues through Sandcastle.
Before Sandcastle performs automatic writing, its Docker or rootless Podman path should use a fixed image, non-root execution, restricted mounts and environment, no GitHub or host credentials, no devices or Docker socket, bounded untrusted diagnostics, and complete validation before parent-controlled push.
OpenShell, Gondolin, and other stronger providers require a real adapter and conformance tests rather than being assumed drop-in replacements.

## Future observability

Dogfooding should determine whether bounded Validation Run history, Change activity, richer agent-session inspection, and external tracing are worth adding.
Unknown token and cost usage must remain distinct from zero.

## Coordinator and Supervisor

A future Coordinator Agent, terminal UI, or user-level Supervisor may dispatch and monitor many repositories.
These remain clients of durable Task, Change, validation, and PR interfaces rather than owners of workflow state.
A future Supervisor should remain infrastructure-only and own durable wakes, repository process isolation, restart recovery, and worker health without making Task decisions.
Their design begins only after the manual workflow and optional Herdr dispatch have been dogfooded.

## Historical planning source

Commit `9c50334` preserves the detailed 55-Task plan and removed ADRs that preceded the reduced v1.
Those documents are research history rather than accepted future specifications.
