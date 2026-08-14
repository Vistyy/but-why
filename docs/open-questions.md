# Open Questions

This file is the repository's explicit exception for unresolved product and architecture questions that are intentionally deferred outside the current Task model.
It helps maintainers decide whether later evidence warrants formal design work.
These questions do not approve implementation, establish priority, or define active work.
Current implementation work and accepted intent belong in SQLite Tasks.
Settled behavior belongs in the contexts linked from `CONTEXT-MAP.md`, accepted ADRs, and current system documentation.

## How should reviewer quality be measured?

After v1 dogfooding, consider a repository-specific reviewer benchmark only when real use or a focused architecture investigation supplies difficult, consequential cases.
Do not create obvious smoke fixtures solely to establish a baseline.
Candidate cases should come from material reviewer misses, unsupported Findings, inconsistent judgments, and concrete architecture problems that require substantial repository reasoning.
Any benchmark must keep Acceptance Reviewer and Specialist authority distinct and preserve each exact Candidate, applicable authority, and reviewer configuration under evaluation.
It should include difficult valid Candidates that test whether reviewers avoid optional or out-of-scope Findings.
Evaluate material-problem recall, unsupported Findings, evidence quality, and difficult correct passes through semantic human adjudication initially.
Do not use exact wording matches, aggregate scoring, repeated statistical runs, or an LLM judge before evidence establishes that the added machinery improves trustworthy evaluation.
A benchmark remains deferred work rather than a v1 release requirement or an approved initiative.

## Should Specialists run in parallel?

Specialists run sequentially in v1.
Reconsider parallel execution only after real-use evidence justifies workspace isolation, resource limits, failure collection, cancellation, and deterministic ordering.

## How should agent monetary cost be measured?

Reviewer invocations record token usage when Pi reports it and preserve unavailable usage as `null`.
But Why does not yet record an authoritative monetary cost.
Future design must decide whether provider estimates or billing records are sufficient and whether automatic work needs user-defined spending limits.

## How should agent execution identities work?

V1 resolves Pi Agent Profiles from explicit Repo or Global references.
Each profile selects its model, thinking level, and optional Pi resource allowlists.
The Reviewer Agent Runtime accepts a swappable Reviewer Process Executor, so another Adapter can provide the current Pi process contract.
The input profile and Reviewer Session behavior remain Pi-shaped, so an arbitrary Codex or Claude harness is not a process-executor-only substitution.
The remaining design question is whether a later harness requires a separate execution identity and session interface.

## How should But Why represent and review planning above individual Tasks?

Tasks do not currently represent membership in one overarching planning effort, and Task Dependencies represent only implementation or verification prerequisites.
Future design must decide whether a durable planning aggregate should own the overarching outcome, accepted requirements and constraints, unresolved decisions, holistic verification mapping, and intended decomposition.
It must support partial Task materialization without treating the currently recorded Tasks as the complete plan.

Any future Planning Review must distinguish accepted requirements and observed repository constraints from candidate mechanisms before those candidates become Task scope, dependencies, implementation constraints, or verification obligations.
Reviewer conclusions may identify unsupported or disproportionate scope, but they must not themselves expand planning authority.
Planning Review must not require speculative within-Task implementation structure solely to make a proposal reviewable.

The design must determine whether review targets the complete aggregate, an explicitly bounded Task set, or both.
It must define how reviewers judge requirement coverage, Task ownership and overlap, decomposition, and initiative-level overengineering or underengineering when only part of the work has become Tasks.
It must evaluate how proposed ownership, interfaces, state, and coordination compose across the reviewed boundary rather than judging each Task only in isolation.
A locally coherent Task can still contribute to an incoherent aggregate when its building blocks duplicate knowledge, representation, state, or coordination across Tasks.
An arbitrary Task set must not imply completeness or shared planning authority without an explicit boundary that gives the set that meaning.
Without that boundary, a reviewer cannot conclude that the aggregate design or decomposition is complete.

Before implementation, define approval authority, lifecycle, storage, review history, Task derivation, revision behavior, and the relationship with Task Approval and Task Recording Authorization.
The design must decide whether Planning Review occurs before Task Recording Authorization, which material revisions require another review, and whether consequential structure selected after Task Approval needs a separate review before broad implementation.
The design should replace temporary tracked planning artifacts without moving active planning intent into another repository document convention.

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

Before unattended implementation, define an Implementation Budget.
The budget might bound elapsed time, model usage or cost, agent iterations, tool calls, or another measure.
Later design must decide whether the budget belongs to a Task, Change, or individual implementation attempt.
It must also define exhaustion behavior, additional authorization, resume behavior, evidence, and whether enforcement can be hard or only advisory.
An agent completion signal can report claimed completion, but it does not enforce the budget.

## How should But Why separate operator, Implementer, and reviewer authority?

Implementers and reviewers currently use the same local CLI and Shared Repository State as the main operator.
An Implementer can therefore invoke operator-owned lifecycle commands or edit local state as an easier substitute for completing accepted work.
A reviewer may need read-only Task inspection without authority to mutate Task or Change lifecycle state.
Future design should make accidental and reward-seeking destructive actions impractical without obstructing normal implementation or required review evidence gathering.
It does not need to defend against a fully hostile process running as the same operating-system user.

The design must define operator authority, Implementer authority, reviewer authority, subagent delegation, and the trust boundary around Shared Repository State.
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

## How should Candidate Publication present the complete work to a human reviewer?

The current owned pull-request body exposes the Task identity and Implementation Decision Log, but it does not synthesize the Task and Change lifecycle into a review experience.
Future design should determine how an agent examines the approved Task intent, Task Review history, Task Dependencies, Acceptance Context, Implementation Decisions, Implementation Blockers and Resolutions, historical Candidates and Findings, the exact passing Validation Run, selected evidence, and the final code to explain the complete Change without dumping those records.

The presentation should help a human understand the behavior, affected code beyond the changed lines, and the material path by which the exact Candidate became publishable.
It must bind every Candidate-specific claim to the exact published Candidate and Validation Run.
An earlier Candidate's Finding may be presented as historical, but a later passing Candidate does not by itself establish a durable one-to-one Finding resolution.
The design must decide which additional lifecycle provenance must be recorded before publication can make stronger claims.
The synthesis agent should explain existing accepted and validated evidence rather than perform another broad correctness review, create Findings, or independently reopen accepted scope.

The presentation should combine a small stable review spine with adaptive content.
The stable part should make recurring facts easy to scan, while the agent remains free to select useful prose, tables, one or more diagrams, or other media for the Change.
Guidance should state the review outcomes and useful presentation techniques without requiring every optional section or one universal document shape.
A deterministic boundary should validate provenance, references, size and safety constraints, generated-content ownership, and remote mutation recovery without prescribing the complete narrative structure.

When a revised Candidate updates an existing owned pull request, presentation generation should receive the prior published presentation and the new exact lifecycle evidence.
It should revise what changed rather than independently regenerate the complete explanation from scratch.
The design must define the stable identity and storage of each proposed presentation, how an uncertain GitHub mutation reuses the same proposed content, how the revised result removes stale claims, and whether human-authored edits can exist outside a publisher-owned section.

The design should evaluate whether one `low`, `medium`, or `high` review signal is useful without conflating impact, delivery difficulty, review effort, and merge safety.
Its name and definition should communicate how much risk requires deliberate human review without implying that the classification alone determines merge eligibility.

The [no-mistakes pipeline](https://github.com/kunchenguid/no-mistakes) and [pull request 711](https://github.com/kunchenguid/no-mistakes/pull/711) are useful comparable evidence.
Its separation of intent, changed behavior, risk, evidence, and machine-readable lifecycle data is relevant, while its full intent dump, repeated clean-step output, raw automated-test transcripts, and stale head-bound presentation show failure modes to avoid.

## How should initial delivery expectations be compared with observed Change history?

A Task may initially appear small, familiar, or easy to implement, while its Change later exposes unexpected scope, Decisions, Blockers and Resolutions, repeated Candidate or Submission attempts, historical Findings, or materially different verification needs.
A concise comparison could help a human notice that the work differed materially from its initial expectation.
Preserved expectations and observed outcomes could later support analysis across completed Changes outside the publication lifecycle.

Do not include Initial Delivery Expectations or expectation-versus-outcome comparison in the first publication-presentation version.
Before implementation, determine which concepts are useful, when an expectation is recorded, who produces or accepts it, whether it belongs to Task Intent or Change Delivery, how Changes without a Task participate, which observations are authoritative, and how confidence and changed understanding are represented without one misleading mutable score.
Keep delivery difficulty, impact, uncertainty, review effort, review scrutiny, and merge safety distinct unless evidence supports a defined relationship.
Counts of Decisions, Findings, attempts, elapsed time, or usage must not by themselves imply risk or process failure.
Any later publication presentation should only flag a material per-Change divergence and should not own cross-Change diagnosis or recommendations about systemic causes.

## How should publication provide code-anchored Review Guidance?

A future publication agent may identify a concise review path through important files or lines, including affected code that is not itself changed.
GitHub file-level and line-level review comments can provide useful spatial guidance, but they can also create notification noise, resemble Findings, and become outdated when a revised Candidate changes the diff.

Do not include code-anchored Review Guidance in the first publication-presentation version.
Before adding it, dogfood body-level file and line links and define annotation purpose, selection limits, exact-Candidate binding, stable identity, update and removal behavior, revised-Candidate reconciliation, and visual distinction from actionable Findings and Operator feedback.
The design should determine whether GitHub review comments, Check annotations, body links, or another platform-specific surface best preserves the guidance.

## How should human-inspectable evidence be published?

Validation currently retains bounded local Artifact Content while a Change is Open and removes that content during Terminal Cleanup.
Future publication may need to present non-automated or one-time evidence that helps a human judge observable behavior, such as screenshots, recordings, focused experiments, exploratory verification, before-and-after comparisons, and environment-specific observations.
Routine passing test and lint output should not be repeated when it adds no review information.

Before implementation, define evidence selection, supported media, redaction, access control, truncation disclosure, exact Candidate and environment binding, durable hosting, retention, cleanup, and behavior when evidence becomes unavailable.
Distinguish direct evidence from an agent's summary of that evidence.
Do not treat GitHub Checks or commit statuses as the evidence merely because they can transport a result or link.

## How should opportunities outside the accepted Change become follow-up work?

Implementation, validation, and publication agents can discover missing adjacent behavior, worthwhile improvements, or affected code outside the accepted Change that should not expand the current scope.
A pull-request presentation may disclose a material limitation or intentionally excluded concern, but editable pull-request prose should not silently create accepted work or imply that every optional improvement is required.

Future design must determine which observations deserve durable follow-up records, who judges their relevance and scope, how they relate to the originating Task or Change, whether they become proposed Tasks, and how duplicates and speculative agent suggestions are controlled.
Keep follow-up discovery separate from the exact Candidate's passing judgment and from accepted Task intent.

## How should Operator Review Feedback re-enter an Open Change?

Dogfooding identified a need for the Operator to annotate code on an owned pull request and return one review to the Implementer without managing each GitHub conversation as workflow state.

Any imported feedback must be bound to the exact owned pull request, reviewed head commit, and configured Operator identity.
Text authored by another identity must remain untrusted and must not become agent instructions.

The design must determine which explicit Operator action authorizes import, whether the feedback is Change-owned correction input or an accepted-intent change, and what evidence establishes that the Implementer reassessed it.
It must also determine how the Implementer and validation reviewers receive the same immutable feedback and when But Why may resolve corresponding GitHub conversations without requiring individual Operator decisions.

Do not require draft pull request publication for this capability.
Reconsider publishing unvalidated implementation only after dogfooding establishes that inspecting unfinished work provides material value.

## Should exploratory work be imported into a Change?

V1 requires the user to commit exploratory work, start a Change without a Task, and cherry-pick the commit into its Managed Worktree.
A future `by change import` command may copy committed and uncommitted work into a new Change without a Task without modifying the source checkout.
Do not extend Change Start with import behavior because clean Change creation and existing-work import have different safety and recovery contracts.
Before implementation, define support for staged, unstaged, untracked, ignored, binary, conflicted, submodule, and concurrently modified work.

## Should But Why support another Interactive Session Host?

V1 uses Herdr for Interactive Sessions.
Add another host only after a second implementation proves a shared interface.

## Should validation be conditional?

V1 uses the fixed changed-code Validation Gate and does not validate an unchanged tracked tree.
Future configuration may select Checks or Specialists from trusted facts such as changed paths or Task metadata.
Use named conditions instead of a generic workflow language.

## Where should lifecycle customization use hooks?

Generic lifecycle hooks can make an orchestration engine more reusable and customizable than But Why's fixed named phases.
Explore hooks only after a concrete repository workflow requires lifecycle behavior that the current Preparation, Checks, Specialists, integrity, and cleanup boundaries cannot represent coherently.

Before adding hooks, define trusted configuration, execution location, ordering, timeout, cancellation, failure behavior, evidence capture, and permitted side effects.
Hooks must not bypass Validation Gate policy, Candidate integrity, authority boundaries, or cleanup evidence.
Prefer named extension points when the behavior has stable domain meaning, and do not introduce a generic workflow language without evidence that named extension points are insufficient.

## How should reviewer execution use containers?

V1 supports host execution only.
Containerized reviewer execution is unsupported in v1 and deferred until after v1.
The Agent Environment configures the repository toolchain for host-run agents.
The project-owned Pi Reviewer Adapter uses Effect command interruption to terminate its process tree before Snapshot Workspace cleanup.
Automatic interrupted-run recovery remains unsupported.

Before reconsidering containerized reviewers after v1, define the maintained image and toolchain, writable mounts, Git access, credential exposure, network access, process ownership, cleanup, and resource limits.
Measure whether CPU limits prevent reviewer experiments or repository Checks from monopolizing the development host.
Select another execution provider only when it can preserve the current reviewer process, session, resource, usage, and interruption contracts.

## Does automatic writing need stronger isolation?

Read-only validation uses project-owned workspace and execution contracts.
Snapshot Workspaces use project-owned native Git worktrees and Effect command execution and provide no container isolation.
Before automatic writing uses a container provider, that path must use a fixed image, non-root execution, restricted mounts and environment, no host credentials, no devices or Docker socket, bounded diagnostics, and complete validation before a parent-controlled push.

OpenShell, Gondolin, or another provider requires an adapter and conformance tests.

## Which observability is useful?

Dogfooding should determine whether Validation Run history, Change activity, agent-session inspection, and external tracing justify their maintenance cost.
Usage reporting must preserve the distinction between recorded `null` usage and measured zero usage.

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
