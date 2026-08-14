# Candidate Publication presentation plan

**Status:** Deferred until after the first-release baseline.
The prior provisional approval is not current planning direction because publication inputs and Task Review access may change.
Do not use this plan as implementation authority.

**Scheduling:** Reassess this plan after the first-release baseline.
It may consume the approved Agent Session and Agent Invocation direction, but it is not part of the initial Agent Session work and supplies no requirements to the first-release baseline.
Any later accepted persistence change uses a normal post-baseline migration.

**Removal condition:** Remove this file after the Operator approves the plan and every accepted requirement and qualifying decision is recorded in its applicable SQLite Task, current domain context, accepted ADR, or current documentation source.

## Outcome

Candidate Publication creates and maintains a concise pull request title and body that help a human understand and review the exact published Candidate.
An agent synthesizes bounded Task and Change lifecycle evidence and inspects the exact Candidate workspace.
But Why renders a stable, scannable outer structure, binds the presentation to exact publication facts, and safely creates or updates the owned pull request.

The synthesis agent explains accepted and validated work.
It does not perform another broad correctness review, create Findings, reopen accepted scope, discover follow-up work, or mutate GitHub.
But Why alone applies the exact persisted presentation to GitHub.

## Task boundary

The work is split into independently reviewable deliverables.

1. A separate prerequisite generalizes the current Reviewer Session infrastructure into a shared Agent Session capability while preserving existing review behavior.
2. This Candidate Publication presentation work consumes the shared Agent Session capability.

`agent-session-execution.md` owns shared Agent Session and Agent Invocation behavior.
`release-baseline-cutover.md` owns the first-release physical schema without this deferred presentation behavior.
This plan owns Publication Agent behavior and Candidate Publication state and consumes those shared capabilities.
This plan assumes only that Candidate Publication receives an exact Candidate and an upstream-selected eligible passing Validation Run.
It does not define when Validation must rerun.

## Version 1 scope

Version 1 includes:

- An agent-authored pull request title.
- A stable body spine with adaptive review content.
- A `Low`, `Medium`, or `High` Risk signal with a concise rationale.
- Bounded synthesis of Task and Change lifecycle evidence.
- Exact Candidate workspace inspection without injecting the complete diff into the prompt.
- Initial presentation generation.
- Agent Session continuation when generation is retried or a revised Candidate needs an updated presentation.
- Revision from the prior published title and body instead of independent regeneration from scratch.
- Exact pending presentation persistence for crash and uncertain GitHub mutation recovery.
- Complete But Why ownership of the owned pull request title and body.
- A distinct presentation-generation failure that does not fail Validation.
- Publication-specific Agent Profile and optional guidance configuration.

Version 1 excludes:

- Initial Delivery Expectations and expectation-versus-outcome comparison.
- Cross-Change retrospective or systemic analysis.
- Code-anchored Review Guidance through comments or annotations.
- Published screenshots, recordings, and other human-inspectable media evidence.
- Follow-up opportunity discovery or Task creation.
- Automatic merge policy.
- A Candidate Publication chronology or presentation history.
- A separate presentation inspection command or normal Change inspection expansion.
- Deep GitHub Markdown parsing or validation.

These deferred areas are recorded in `docs/open-questions.md`.

## Pull request ownership

But Why owns the complete title and body of its owned pull request.
A valid revised Candidate Publication may overwrite human edits to those fields.
Human edits are not preserved or merged in version 1.

The agent owns the complete proposed title.
It may retain or refine the Task title when present.
The title does not require a Task ID, Conventional Commit syntax, or another fixed prefix.
It must concisely describe the final Change without introducing unsupported scope or claims.

## Stable presentation structure

The synthesis agent returns structured fields:

- `title`
- `overview`
- `risk`, with value `low`, `medium`, or `high`
- `riskRationale`
- `reviewGuideMarkdown`

But Why deterministically renders the outer body structure:

```markdown
## Overview

[Agent-authored overview]

**Risk: Medium**

[Agent-authored rationale]

## Review guide

[Agent-authored adaptive Markdown]

<details>
<summary>Publication provenance</summary>

Change: `...`
Task: `...` when Change linked to a Task
Candidate: `...`
Validation Run: `...`
Head: `...`
Change Base: `...`

</details>
```

The Overview, Risk, and Review guide are always in predictable locations.
The Review guide remains adaptive and may contain prose, tables, Mermaid diagrams, collapsible sections, file links, material lifecycle history, Decisions, Blockers, historical Findings, and explanations of affected unchanged code.
It must not contain empty sections merely because a lifecycle category exists.

## Risk signal

The stable signal is **Risk: Low / Medium / High**.
It indicates how much potential risk a human should consider before merging the exact Candidate.
It has no authority to approve, block, or automatically merge the pull request.
It is not Finding severity, implementation effort, business value, or Validation outcome.

The synthesis agent may consider:

- Consequences if the Candidate is incorrect.
- Breadth of affected behavior.
- Sensitive boundaries such as persistence, permissions, remote mutation, or compatibility.
- Novelty and remaining uncertainty.
- Reversibility and recovery cost.
- Whether Validation directly observed consequential behavior.
- Material historical Findings, Decisions, or Blockers when they explain risk.

Diff size, elapsed time, Decision count, and Candidate count do not independently determine Risk.
Every Risk value requires a concise Candidate-specific rationale.

## Lifecycle projection

The synthesis input includes:

- Compact Task ID for a Change linked to a Task.
- Exact Acceptance Context.
- Task Review records with the exact proposal, outcome, Findings, and whether the Review applies to the approved Task.
- Complete Implementation Decision history.
- Complete Implementation Blocker and Resolution history.
- Historical Candidate identities.
- Historical Validation Run identities and outcomes.
- Findings belonging to historical Validation Runs.
- Bounded Tooling Failure facts when present.
- Phase outcomes for the exact passing Validation Run selected for publication.
- The prior published title and body when revising an existing owned pull request.
- Exact Candidate and Change Base identities.
- Any lifecycle-input truncation disclosure.

Task Review history is included experimentally.
For a Change linked to a Task, publication reads the existing immutable Task Review records when synthesis needs them and does not copy them into the Change at Change Start.
Changes without a Task have no Task Review input.
The agent must include Task Review history in the pull request only when it materially improves understanding.
Dogfooding should determine whether it is useful or noisy.

The synthesis input excludes by default:

- Task Dependencies.
- An injected complete diff.
- Reviewer and Implementer transcripts.
- Raw stdout and routine passing test logs.
- Artifact Content.
- Usage and cleanup diagnostics.
- Initial Delivery Expectations.
- Speculative follow-up opportunities.

The agent inspects the diff and surrounding code itself in the exact Candidate workspace.
Semantic-history limits are generous and exist only for pathological input sizes.
If a category is truncated, the prompt identifies the omitted category and amount, and the Review guide must disclose that it did not synthesize the complete lifecycle.

## Agent configuration and continuity

The PR presentation agent has its own optional Agent Profile selection under publication configuration.
It resolves from Repo Config, then Global Config, then the Global default Agent Profile.
No separate profile is required when the Global default is available.
Submission returns `publication_configuration_invalid` before Validation when no profile can resolve or selected publication guidance is invalid.
This early failure does not create or fail a Validation Run.

But Why ships mandatory publication-synthesis instructions.
The presentation agent receives the exact workspace and supplied lifecycle evidence.
Presentation synthesis does not rely on GitHub or other network access, and the agent has no GitHub mutation capability.
Repo Config may select one publication guidance file, and Global Config may supply fallback guidance.
Repo guidance takes precedence and resolves from the exact Candidate.
Global guidance resolves from the Global Config directory.
Guidance may shape terminology, reviewer audience, title conventions, diagrams, and explanation emphasis.
It cannot alter Candidate provenance, Risk values, publication safety, or the structured output contract.

Publication synthesis uses a Change-owned Agent Session for a distinct Publication Agent role.
It does not share an Agent Session with an Acceptance Reviewer, Specialist Reviewer, or another agent role.
A failed generation retry resumes the compatible session for the same Candidate when possible.
A revised Candidate resumes the compatible session with the new lifecycle evidence and prior published presentation.
A changed Agent Profile, instructions, environment, or resources makes the prior session incompatible according to Agent Session rules.
An unusable session restarts according to those rules.
When the Change closes, Publication Agent continuation ends and its transcript is retained through the shared Agent Session cleanup rules.

If synthesis succeeds and GitHub mutation is later uncertain, But Why does not resume the agent.
It reuses the exact persisted proposal.

## Generation and validation

The synthesis agent receives bounded instructions and produces one structured result.
The shared Agent Session runtime may ask the same agent to correct invalid structured output.
But Why accepts the first contract-valid presentation.
It does not run another agent review, deterministic quality score, or improvement pass.

Version 1 validates only the structured contract:

- Title, Overview, Risk rationale, and Review guide are non-empty strings.
- Risk is exactly `low`, `medium`, or `high`.
- Fields obey generous supported size limits.
- Exact provenance is rendered by But Why rather than supplied by the agent.

But Why does not implement a GitHub Markdown parser or deep Markdown validator.
The adaptive Markdown is trusted after the structured contract passes.
Raw agent stdout is never published.

## Presentation failure

Presentation generation is part of Candidate Publication, not the Validation Gate.
A generation failure does not fail, replace, or mutate a passed Validation Run.
A later Submission reuses eligible passing Validation evidence and retries presentation generation.

The distinct Submission failure is `publication_presentation_failed`.
It includes Change, Candidate, and Validation Run identity, a bounded failure classification and message, and actionable retry guidance.
Expected classifications include process execution, output contract, and workspace integrity failures.
Agent stdout is not included.

On presentation failure:

- No new pending Candidate Publication is begun for that proposal.
- An existing owned pull request remains bound to its prior confirmed Candidate and presentation.
- The Agent Session remains resumable unless incompatible or proven unusable.
- Workspace cleanup completes before the command returns or reports its own actionable recovery problem.

No deterministic fallback title or body is published.

## Presentation source digest

Presentation reuse uses a publication-specific source digest.
Validation eligibility and Agent Session compatibility retain their own independent mechanisms.
They do not share one cross-domain fingerprint.

The presentation source digest represents meaningful semantic inputs that can make the stored title and body stale:

- Exact Candidate and head.
- Upstream-selected Validation Run.
- Acceptance Context content.
- Task Review outcomes and Finding content supplied to synthesis.
- Implementation Decision content.
- Blocker and Resolution content.
- Historical Validation outcomes and Finding content.
- Truncation disclosures.

The digest excludes incidental metadata:

- Record timestamps and database sequence numbers.
- Usage evidence.
- Storage paths and cleanup facts.
- JSON property order.
- GitHub state.
- Raw output.
- Agent Session references.

Once a valid proposal is stored, later changes to the current publication Agent Profile, mandatory instructions, optional guidance, environment, or resources do not invalidate that proposal.
Those inputs govern generation and Agent Session compatibility, not whether completed prose is semantically stale.

## Pending and confirmed publication state

Version 1 extends current Change-owned Candidate Publication state rather than adding presentation history.
The logical state distinguishes:

- Active generation, which identifies the Change, Candidate, Validation Run, presentation source digest, and unsettled Agent Execution before complete presentation content exists.
- A complete pending proposal awaiting publication mutation or reconciliation.
- The last confirmed publication and presentation.

Successful Agent Execution settlement replaces active-generation state with the complete pending proposal rather than retaining generation history.
The pending proposal includes the exact proposed title, complete rendered body, Risk, Candidate and Validation Run binding, presentation source digest, and successful Agent Execution ID.
Exact head and Change Base are derived from the immutable Candidate rather than duplicated.
Confirmed state requires pull request number and URL.
Pending state omits those fields and uses confirmed state when updating an existing pull request.
Confirmed state retains the successful Agent Execution ID as generation evidence.
The release-baseline review selects the physical table count and placement.

The update flow is:

1. Keep the last confirmed publication unchanged.
2. Generate and validate a new proposal when required.
3. Persist the exact pending proposal before GitHub mutation.
4. Mutate or recover GitHub using that exact proposal.
5. Confirm the remote title, body, target, and head.
6. Promote the pending proposal to current confirmed publication and clear pending state.

An uncertain GitHub result is reconciled against exact pending and confirmed facts.
If the exact Candidate merges during uncertainty, reconciliation promotes pending only when the merged pull request's title, body, target, and head match it.
Otherwise, terminal reconciliation retains the prior confirmed snapshot, clears unconfirmed pending state, and completes the already merged exact Candidate without claiming unverified presentation evidence.
A retry never regenerates an already persisted exact proposal.
No Candidate Publication or presentation chronology is retained in version 1.
Candidate Publication remains owned by Change Delivery regardless of its physical persistence representation.

The title, body, Risk, and source digest remain internal in version 1.
GitHub is the presentation surface.
Normal Change inspection continues exposing publication identity and state without returning the generated Markdown.

## Presentation freshness outcomes

Candidate Publication distinguishes:

1. **Completed publication reuse:** Return stored success when the exact completed publication remains current.
2. **Pending proposal reuse:** Reuse the exact stored proposal and continue GitHub recovery without invoking the agent.
3. **Generation or revision:** Invoke or resume the Agent Session only when no reusable proposal exists for the desired semantic presentation input.

Later producer-configuration changes do not retroactively rewrite a completed publication.
An existing open owned pull request that predates stored presentation state is upgraded through fresh generation on its next Submission.
Its current remote title and body are not supplied as prior agent output because But Why cannot establish that provenance.
The resulting complete presentation may replace existing human edits under the normal ownership rule.
But Why does not run a background migration or mutate GitHub merely because the software was upgraded.
Change Submission owns the upstream rule for which Validation Run is eligible.
Publication owns only presentation and remote-publication freshness.

## Submission Workspace

The existing validation-only Snapshot Workspace concept broadens to a **Submission Workspace**.
This is a provisional domain term and is not yet authorized for recording in `docs/context/change-delivery/CONTEXT.md`.

A Submission Workspace is one disposable detached Git worktree for the exact Candidate during Submission.
It is used by fresh Validation when needed and then reused by publication synthesis.
When Validation evidence is reused, a Submission Workspace can be acquired for synthesis without running Validation.
The workspace retains configured copied files unchanged between Validation and synthesis.
But Why does not specially remove or generically clean those files.
Existing allowed-file integrity semantics continue to apply.

Each active Submission Workspace requires durable recovery facts:

- Durable workspace identity.
- Change and Candidate identity.
- Exact expected commit.
- Exact path.
- Cleanup state.
- Selected Validation Run reference when applicable.

Change Delivery's Submission operation owns Submission Workspace lifecycle and recovery across Validation and publication synthesis.
The release-baseline plan selects its physical persistence representation.
The durable recovery state exists only while setup, use, or cleanup remains active and is removed after successful cleanup.
Validation and Publication retain their own evidence rather than permanent workspace history.
The required behavior is that But Why records recovery facts before worktree creation and verifies exact identity, path, commit, and cleanliness before reuse or cleanup.

The workspace is cleaned immediately after a valid presentation is persisted and before GitHub mutation.
GitHub recovery then needs only durable pending publication state and no workspace.
If workspace cleanup fails after a valid proposal is persisted, Candidate Publication preserves the pending proposal, stops before GitHub mutation, and returns a distinct workspace cleanup failure with actionable recovery information.
A retry completes cleanup and reuses the exact pending proposal without invoking the agent again.

Publication safety verifies the actual Candidate before remote mutation.
The Repository Branch must still point to the exact Candidate head, and the Candidate and selected passing Validation Run must still match the publication input.
If the Repository Branch no longer points to that Candidate, But Why does not publish the pending presentation.
It first reconciles that the pending proposal was not already applied remotely, then permits a later Submission to replace it for the newly selected Candidate.
Version 1 adds no separate post-synthesis Submission Workspace integrity check solely to detect agent writes because the disposable workspace cannot change the Candidate and is removed before publication.

## Remote behavior

A first Candidate Publication creates the owned remote branch and pull request with the exact stored proposal.
A revised Candidate resumes synthesis from the prior published presentation, stores a complete replacement proposal, and updates the same owned pull request.
The agent returns complete replacement fields rather than textual patches.

But Why can overwrite remote human edits to the owned title and body during a valid Candidate Publication.
It does not merge remote edits.

The existing exact head, target, owned pull request, force-with-lease, uncertain-response reconciliation, and postcondition confirmation rules remain controlling.
Presentation generation cannot weaken them.
If GitHub merges the exact Candidate after its branch update but before the replacement title and body are confirmed, the merge completes the Change.
But Why does not let the presentation failure undo completion or require a post-merge presentation update.

## Provisional domain terms

The following proposed terms have been accepted for planning but are not yet authorized for domain-context recording:

**Submission Workspace:** A disposable exact-Candidate worktree used across the Submission operations that require repository inspection, including fresh Validation and publication synthesis.

**Risk:** A `Low`, `Medium`, or `High` presentation signal explaining the potential risk a human should consider before merging the exact Candidate, without merge authority.

**Publication Agent:** The agent role that synthesizes one Change's pull request presentation from the exact workspace and supplied lifecycle evidence without performing Validation or mutating GitHub.

A distinct durable Publication Presentation history is not proposed.
The current and pending title, body, Risk, and digest are parts of Candidate Publication state.

## Resolved decisions

- Use two Tasks rather than one oversized Task.
- Agent Session generalization is the prerequisite Task.
- But Why owns the complete PR title and body.
- Presentation generation failure blocks Candidate Publication but does not fail Validation.
- Publication has its own optional presentation Agent Profile selection and guidance file, with fallback to the Global default and early configuration failure before Validation.
- A distinct Publication Agent role owns its own Change-owned Agent Session and does not share reviewer conversations.
- Agent Session continuation handles failed generation and revised Candidate synthesis, ends when the Change closes, and retains its transcript through shared cleanup rules.
- GitHub retry uses exact persisted content without another agent call.
- Use a stable outer body spine with adaptive Review guide Markdown and collapsed Change, optional Task, Candidate, Validation Run, head, and Change Base provenance.
- Use `Risk: Low | Medium | High` with rationale.
- Let the agent author the complete PR title without mandatory Task ID or format.
- Use the approved bounded lifecycle projection and exact workspace inspection.
- Preserve Task Review proposal provenance experimentally by reading existing Task Intent records without copying them into the Change.
- Use minimal structured-output validation and no deep Markdown validation.
- Accept the first contract-valid presentation without another review.
- Use a publication-specific semantic source digest rather than a shared cross-domain fingerprint.
- Keep separate confirmed and pending publication state without adding chronology.
- Keep generated content internal outside GitHub in version 1.
- Broaden Snapshot Workspace into Submission Workspace behavior.
- Retain configured copied files unchanged for synthesis.
- Require durable workspace recovery facts while deferring physical schema design.
- Clean the workspace after proposal persistence and before GitHub mutation.
- Verify the actual Candidate before GitHub mutation without adding a separate post-synthesis workspace check.
- Reconcile and withhold a stale pending proposal before allowing a later Submission to replace it for a newly selected Candidate.
- Preserve a valid pending proposal across Submission Workspace cleanup failure and retry cleanup without another agent call.
- Treat an exact-Candidate merge as completion even when its replacement presentation was not confirmed, without requiring a post-merge presentation update.
- Limit presentation synthesis to the exact workspace and supplied lifecycle evidence without relying on GitHub or other network access; give the agent no GitHub mutation capability.
- Upgrade an existing open owned pull request without stored presentation state through fresh generation on its next Submission, without treating remote content as prior agent output or running a background GitHub migration.

## Unresolved decisions

- Author the exact dependent Task only after the Agent Session and release-baseline plans establish the applicable execution and persistence direction, the prerequisite Agent Session Task is available, and Task Recording is authorized.
- Evaluate implemented architectural decisions against the ADR gate after implementation.
- Keep the accepted `Submission Workspace`, `Risk`, and `Publication Agent` definitions in this plan until the functionality is implemented, then record them in Change Delivery Context only with separate Operator authorization.
- Integrate the parallel schema design's physical representation without changing this plan's required behavior.

## Approval and authorization status

The overall plan is approved as planning context.
No ADR records this planned functionality.
ADR qualification occurs after implementation against the implemented current system and existing ADR authority.
No implementation is authorized.
No But Why Task Recording, Task Submission, Task Approval, or Implementation Authorization has been granted by this plan.
The accepted `Submission Workspace`, `Risk`, and `Publication Agent` definitions remain plan-only until the functionality is implemented.
Recording them later in Change Delivery Context requires separate Operator authorization.
