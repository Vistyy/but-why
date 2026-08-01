# Open Questions

This file is the repository's explicit exception for unresolved product and architecture questions that are intentionally deferred outside the current Task model.
It helps maintainers decide whether later evidence warrants formal design work.
These questions do not approve implementation, establish priority, or define active work.
Current implementation work and accepted intent belong in SQLite Tasks.
Settled behavior belongs in the contexts linked from `CONTEXT-MAP.md`, accepted ADRs, and current system documentation.

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

## Where should disposable Validation Workspaces live?

Sandcastle places each v1 Validation Workspace under the consumer repository at `.sandcastle/worktrees/`.
Recursive repository tools can discover an abandoned Validation Workspace unless the repository excludes `.sandcastle/**`.
V1 setup guidance must direct the user's coding agent to configure that exclusion.
But Why does not edit consumer tool configuration automatically.

After v1, move Validation Workspaces outside the consumer repository and remove Sandcastle's control of their placement.
Before implementation, select the external location and define naming, Git registration, cleanup, recovery, and repository-relocation behavior.

## How should agent usage and cost be measured?

Sandcastle does not return trustworthy Pi token or monetary usage.
Future reporting must distinguish unknown usage from zero usage.
After trustworthy usage exists, decide whether automatic work needs user-defined spending limits.

## How should agent execution identities work?

V1 resolves Pi Agent Profiles from explicit Repo or Global references.
Each profile selects its model, thinking level, and optional Pi resource allowlists.
The remaining design question is whether later runtimes require a separate execution identity interface.

Evaluate whether Sandcastle can support that design through extension, requires a maintained fork, or should be replaced by another execution boundary.
Keep Sandcastle behind its current domain seams until evidence justifies that decision.

## What role should Task Comments have before Start?

Task Comments currently append Markdown to Task Context before Change Start and become part of approved Acceptance Context.
Direct Task Context editing may be simpler when one operator is refining intent.
Future planning agents or multiple reviewers may instead need durable feedback that remains distinct from accepted intent.
Keep current behavior until observed planning or review usage establishes whether comments should remain intent additions or become a separate record.

## Does Task readiness need another gate?

A Task can depend on uncertain external integration or runtime behavior.
Fake adapters and local unit tests can leave that uncertainty unresolved until Change Submit exercises the real system.

After v1, evaluate an optional Task Preflight that runs a bounded Feasibility Spike before the Task becomes Ready.
The Feasibility Spike should test the real uncertain seam and record evidence that later planning and implementation can use.
Define who identifies a consequential uncertainty, which evidence resolves it, where the result is stored, and whether unresolved uncertainty blocks Task readiness.
Keep Task Preflight separate from completed-code validation.

## How should cancelled Tasks relate to successor work and dependents?

A Cancelled Task is terminal and does not satisfy Tasks that depend on it.
Future design must decide whether a Cancelled Task may have no successor, one successor, or several successor Tasks, and how those relationships remain visible from each Task.
It must also define how users explicitly redirect unfinished dependents without silently rewriting dependencies or treating cancellation as completion.
Revisit this when real replacement work requires more than creating a new Task and manually updating its dependents.

## Should But Why automate implementation and fixes?

AFK Implementers, automatic Fixers, and orchestration-owned stops are deferred.
Before adding them, define process ownership, cancellation, workspace fencing, cost protection, recovery, and security from observed interactive-session behavior.

## How should But Why separate operator and Implementer authority?

Implementers currently use the same local CLI and Shared Repository State as the main operator.
An Implementer can therefore invoke operator-owned lifecycle commands or edit local state as an easier substitute for completing accepted work.
Future design should make accidental and reward-seeking destructive actions impractical without obstructing normal implementation.
It does not need to defend against a fully hostile process running as the same operating-system user.

The design must define operator authority, Implementer authority, subagent delegation, and the trust boundary around Shared Repository State.
Scoped capabilities, a local authority broker, signed authoritative state, and stronger process isolation have been discussed only as possible approaches.
None is accepted architecture.
Revisit this before supporting unattended implementation or automated destructive operations.

## Should But Why stop human-managed Interactive Sessions during cancellation?

V1 leaves Interactive Sessions under human control and does not stop them when a Task or Change is cancelled.
Revisit this only if interactive-session evidence shows that post-cancellation writes create material risk or operational cost.
Any future automation must define session identity, ownership, stop semantics, worktree fencing, recovery, and coordination with safe cleanup.

## Which GitHub events should drive automation?

V1 has no event-driven PR refresh.
Change Submit, Change Reconcile, and Change cancellation read owned pull-request facts explicitly.
But Why does not treat GitHub-authored text as implementation instructions.

Future work may consider webhooks, CI remediation, requested-change workflows, and merge-conflict remediation.
Before implementation, define authority and prompt-injection boundaries from observed evidence.

Automatic remediation must be limited to failed required CI or a confirmed conflict on an exact owned PR and expected SHA.
Comments, reviews, titles, and descriptions must not become agent instructions.
The agent must not receive GitHub credentials or direct push access.
But Why must revalidate before an expected-SHA push.
A human must retain merge authority.
Conflict remediation should merge the latest base into the PR branch, then run the complete Validation Gate.

## Should exploratory work be imported into a Change?

V1 requires the user to commit exploratory work, start a Taskless Change, and cherry-pick the commit into its Managed Worktree.
A future `by change import` command may copy committed and uncommitted work into a new Taskless Change without modifying the source checkout.
Do not extend Change Start with import behavior because clean Change creation and existing-work import have different safety and recovery contracts.
Before implementation, define support for staged, unstaged, untracked, ignored, binary, conflicted, submodule, and concurrently modified work.

## Should But Why support another Interactive Session Host?

V1 uses Herdr for Interactive Sessions.
Add another host only after a second implementation proves a shared interface.

## Should validation be conditional?

V1 uses the fixed changed-code Validation Gate and the Acceptance-only no-change path.
Future configuration may select Checks or Specialists from trusted facts such as changed paths or Task metadata.
Use named conditions instead of a generic workflow language.

## How should reviewer execution use containers?

V1 supports host execution only.
Containerized reviewer execution is unsupported in v1 and deferred until after v1.
The Agent Environment configures the repository toolchain for host-run agents.
Sandcastle host cancellation can return while Pi reviewer descendants continue running.
Automatic interrupted-run recovery remains unsupported until an execution provider proves bounded descendant ownership.

Before reconsidering containerized reviewers after v1, define the maintained image and toolchain, writable mounts, Git access, credential exposure, network access, process ownership, cleanup, and resource limits.
Measure whether CPU limits prevent reviewer experiments or repository Checks from monopolizing the development host.
Decide whether Sandcastle can own this behavior through a maintained supported contract or whether But Why needs another execution provider.

## Does automatic writing need stronger isolation?

Read-only validation uses Sandcastle.
Before Sandcastle performs automatic writing, its container path must use a fixed image, non-root execution, restricted mounts and environment, no host credentials, no devices or Docker socket, bounded diagnostics, and complete validation before a parent-controlled push.

OpenShell, Gondolin, or another provider requires an adapter and conformance tests.

## Which observability is useful?

Dogfooding should determine whether Validation Run history, Change activity, agent-session inspection, and external tracing justify their maintenance cost.
Usage reporting must distinguish unknown values from zero.

## How should optional Effect CLI built-ins fit the public interface?

`--wizard`, `--completions`, and `--log-level` have interaction and output behavior that can conflict with an agent-first, non-interactive CLI and structured stdout.
If an Effect CLI migration exposes these built-ins, leave the library behavior unchanged instead of adding local parsing, routing, or help filtering.
Reconsider them only when a concrete need exists or Effect CLI provides selective built-in configuration through its public interface.
Before supporting them deliberately, define terminal interaction, raw shell-script output, and diagnostic output channels.

## What CLI startup latency matters?

Dogfooding measured approximately 730 ms for the source launcher and 400 ms for the compiled CLI.
The source TypeScript loader accounts for part of the difference, but the compiled startup remains noticeable.
Do not optimize startup until packaged use shows that the delay materially affects agent or human workflows.
Profile the compiled CLI before selecting an optimization.

## Is a Coordinator or Supervisor needed?

A future Coordinator Agent, terminal UI, or user-level Supervisor may dispatch and monitor several repositories.
These clients must use durable Task, Change, validation, and PR interfaces without owning workflow state.

A Supervisor must remain infrastructure-only.
It may own durable wakes, repository process isolation, restart recovery, and worker health.
Design this capability only after dogfooding the manual workflow and optional Herdr dispatch.

## How should agents navigate large Task collections?

V1 returns the complete matching Task inventory in oldest-first order.
Do not add Task text search, saved views, relationship discovery, or another navigation command before post-v1 evidence establishes the required jobs.

Post-v1 design should distinguish exact Task lookup, bounded inventory browsing, relevance-ranked text search, and agent reasoning about possible Task relationships.
Relevance-ranked search is a hypothesis rather than an accepted contract.
Before implementing it, decide its command ownership, searchable Task fields, ranking and tie-breaking behavior, continuation contract, interaction with lifecycle filters, and whether observed usage justifies saved queries.
Search results must not imply that matching Tasks have a dependency relationship.

Linear separates current-view title filtering from workspace search across issue titles, descriptions, and comments.
GitHub provides bounded issue lists with optional search syntax and a separate broader issue-search command.
Jira combines text matching, structured filters, and ordering through JQL at the cost of a larger query language.
Use these products as evidence, but keep But Why's interface agent-first and repository-scoped.

- [Linear search](https://linear.app/docs/search)
- [GitHub issue list](https://cli.github.com/manual/gh_issue_list)
- [Jira issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)

## Historical planning source

Commit `9c50334` preserves the detailed 55-Task plan and removed ADRs that preceded the reduced v1.
Those documents are historical evidence, not accepted specifications.
