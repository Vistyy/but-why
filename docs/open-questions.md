# Open questions

This file tracks unresolved product and architecture questions outside the reduced manual v1 contract.
Settled v1 behavior belongs in the active PRD, glossary, ADRs, and Task drafts.

## Reviewer evaluation

After v1 dogfooding, create SQLite Tasks for:

- Evaluating one Acceptance Reviewer fixture.
- Running a calibrated suite across Acceptance and configured Specialists.
- Comparing prompt, model, and configuration reports over fixed fixtures.

The suite should measure expected Finding detection, clean-result accuracy, and unsupported Findings without becoming a release blocker before the first manual workflow ships.

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

## GitHub automation

V1 refreshes PR facts only through Submit and never treats GitHub-authored text as implementation instructions.
Future work may consider background watching, webhooks, CI remediation, requested-change workflows, and merge-conflict remediation after their authority and prompt-injection boundaries are redesigned from evidence.

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
Future automatic writing may require stronger container isolation, credential mediation, network policy, and reliable transcript or process lifecycle support.

## Coordinator and Supervisor

A future Coordinator Agent, terminal UI, or user-level Supervisor may dispatch and monitor many repositories.
These remain clients of durable Task, Change, validation, and PR interfaces rather than owners of workflow state.
Their design begins only after the manual workflow and optional Herdr dispatch have been dogfooded.
