# Open Questions

This file tracks unresolved product and architecture questions outside the reduced manual v1 contract.
Settled behavior belongs in approved specifications, `CONTEXT.md`, accepted ADRs, and active Tasks.

## How should reviewer quality be measured?

After v1 dogfooding, create SQLite Tasks for an Acceptance Reviewer fixture and a calibrated reviewer suite.
Compare Finding detection, clean-result accuracy, unsupported Findings, prompts, models, and configuration against fixed fixtures.
The suite is not a release requirement for the first manual workflow.

## Should Specialists run in parallel?

Specialists run sequentially in v1.
Reconsider parallel execution only after real-use evidence justifies workspace isolation, resource limits, failure collection, cancellation, and deterministic ordering.

## Should Sandcastle own structured reviewer retries?

V1 performs one local output-correction request because `Sandbox.run()` does not expose structured-output retry.
If Sandcastle gains that capability, remove the local correction path and delegate the behavior.

## How should agent usage and cost be measured?

Sandcastle does not return trustworthy Pi token or monetary usage.
Future reporting must distinguish unknown usage from zero usage.
After trustworthy usage exists, decide whether automatic work needs user-defined spending limits.

## Does Task readiness need another gate?

Dogfooding may justify an optional Task Preflight or a disposable feasibility prototype.
Keep either capability separate from completed-code validation.

## Should But Why automate implementation and fixes?

AFK Implementers, automatic Fixers, and orchestration-owned stops are deferred.
Before adding them, define process ownership, cancellation, workspace fencing, cost protection, recovery, and security from observed interactive-session behavior.

A future Needs Input state must identify a known mechanical blocker.
It must preserve evidence, exhaust approved recovery, and provide a resumable checkpoint.
Agents should make and record reasonable implementation decisions without using that state.

## Which GitHub events should drive automation?

V1 refreshes PR facts only through Submit.
But Why does not treat GitHub-authored text as implementation instructions.

Future work may consider webhooks, CI remediation, requested-change workflows, and merge-conflict remediation.
Before implementation, define authority and prompt-injection boundaries from observed evidence.

Automatic remediation must be limited to failed required CI or a confirmed conflict on an exact owned PR and expected SHA.
Comments, reviews, titles, and descriptions must not become agent instructions.
The agent must not receive GitHub credentials or direct push access.
But Why must revalidate before an expected-SHA push.
A human must retain merge authority.
Conflict remediation should merge the latest base into the PR branch, then run the complete Validation Gate.

## Should But Why support another Interactive Session Host?

V1 uses Herdr for Interactive Sessions.
Add another host only after a second implementation proves a shared interface.

## Should validation be conditional?

V1 uses the fixed changed-code Validation Gate and the Acceptance-only no-change path.
Future configuration may select Checks or Specialists from trusted facts such as changed paths or Task metadata.
Use named conditions instead of a generic workflow language.

## Does automatic writing need stronger isolation?

Read-only validation uses Sandcastle.
Before Sandcastle performs automatic writing, its container path must use a fixed image, non-root execution, restricted mounts and environment, no host credentials, no devices or Docker socket, bounded diagnostics, and complete validation before a parent-controlled push.

OpenShell, Gondolin, or another provider requires an adapter and conformance tests.

## Which observability is useful?

Dogfooding should determine whether Validation Run history, Change activity, agent-session inspection, and external tracing justify their maintenance cost.
Usage reporting must distinguish unknown values from zero.

## Is a Coordinator or Supervisor needed?

A future Coordinator Agent, terminal UI, or user-level Supervisor may dispatch and monitor several repositories.
These clients must use durable Task, Change, validation, and PR interfaces without owning workflow state.

A Supervisor must remain infrastructure-only.
It may own durable wakes, repository process isolation, restart recovery, and worker health.
Design this capability only after dogfooding the manual workflow and optional Herdr dispatch.

## Historical planning source

Commit `9c50334` preserves the detailed 55-Task plan and removed ADRs that preceded the reduced v1.
Those documents are historical evidence, not accepted specifications.
