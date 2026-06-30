# But Why? PRD

## Problem Statement

Agent-assisted coding can produce changes that look complete but do not reliably satisfy the user's actual task intent.

Existing CI checks can prove that tests pass, but they do not know what the task asked for.

Existing task boards can track work, but they do not validate whether the submitted branch is ready to publish.

The user wants a local, agent-first workflow that validates completed code work before it reaches a pull request, records what happened, and makes it clear when human input is needed.

## Solution

But Why? provides a repo-scoped task workflow for validating submitted branches.

A user or agent creates a Task, implements the work on a non-protected branch, and runs `by submit <task-id>`.

But Why? creates a Run, validates the submitted commit through an opinionated Validation Gate, records Findings and artifacts, and publishes through a GitHub PR only when validation passes.

If validation finds any blocking problem or question, the Task moves to `needs_input`.

A human or agent can read the Task Context and latest Findings, make changes or add comments, and submit again.

V1 is synchronous for submission and uses a repo-local daemon only for PR reconciliation.

Sandcastle is the intended execution engine for validation worktrees, command checks, reviewer agents, logs, structured output retries, and token usage.

## User Stories

1. As a user, I want to create a repo-scoped Task with a title and Markdown description, so that an agent has clear intent to implement.

2. As a user, I want every Task to start in `todo`, so that task creation and implementation start are separate decisions.

3. As a user, I want to move a Task from `todo` to `implementing`, so that the workflow records when work begins.

4. As an implementing agent, I want to read Task Context, so that I can understand the title, description, and comments before changing code.

5. As an implementing agent, I want to submit a completed branch with `by submit <task-id>`, so that validation starts from a clear handoff.

6. As a user, I want `by submit` to require a non-protected branch, so that But Why? does not rewrite or repair unsafe branch state.

7. As a user, I want the first submit to bind a Task to the current branch, so that later submits cannot accidentally validate the wrong branch.

8. As a user, I want each submit to create a commit-bound Run, so that validation history is tied to the exact code snapshot that was checked.

9. As a user, I want Run IDs to include the Task ID, so that run history is easy to read.

10. As a user, I want validation to run in an isolated worktree, so that my current checkout is not disturbed.

11. As a user, I want check commands to run before reviewer agents, so that cheap failures can stop validation before token-using review.

12. As a repo maintainer, I want repo-owned check commands, so that But Why? does not become responsible for my CI pipeline logic.

13. As a repo maintainer, I want multiple check commands to be possible, so that different repositories can model validation at the right granularity.

14. As a user, I want an early intent review, so that a branch that does not satisfy the Task does not go through the full review process.

15. As a user, I want configurable reviewer roles, so that each repository can choose the review perspectives it needs.

16. As a user, I want reviewer agents to return structured Findings, so that agents can reliably read, sort, and act on validation output.

17. As a user, I want every v1 Finding to be blocking, so that But Why? does not silently pass known quality concerns.

18. As a user, I want any Finding to move the Task to `needs_input`, so that a human or coordinating agent decides the next action.

19. As a user, I want `by task findings <task-id>` to show the latest Findings without requiring a Run ID, so that the next action is easy to inspect.

20. As a user, I want `by task context <task-id>` to show title, description, and comments, so that agents can gather intent without mixing in run details.

21. As a user, I want comments to be freeform Task Context, so that humans and agents can add clarifications without changing state.

22. As a user, I want clean validation to open or update a GitHub PR, so that only validated changes reach the publishing path.

23. As a user, I want But Why? to watch the PR until it is clean or blocked, so that `ready` means the PR is actually ready for human merge.

24. As a user, I want But Why? to stop at `ready` and wait for a human merge, so that final merge authority stays with me.

25. As a user, I want a daemon to reconcile PR state after submit, so that merged PRs become `done` without a full worker daemon.

26. As a user, I want a one-shot reconcile command, so that I can update PR-derived state without running a daemon.

27. As a user, I want token usage recorded per producer and model, so that I can understand validation cost later without committing to dollar accounting now.

28. As a user, I want CLI output to be structured and agent-readable, so that agents can drive the workflow without scraping prose.

29. As an agent, I want actionable structured errors, so that I can repair setup or state problems without guessing.

30. As a repo maintainer, I want repo config and global agent profiles, so that validation behavior and user defaults are separated.

31. As a user, I want `agentRuntime` and `agentModel` to name agent settings, so that Pi model strings are not confused with generic provider names.

32. As a user, I want Sandcastle to handle execution plumbing, so that But Why? does not reimplement agent running, worktrees, logs, retries, or token usage.

33. As a maintainer, I want a Sandcastle spike before product implementation, so that the execution dependency is proven before the architecture relies on it.

34. As a future user, I want the model to allow auto-fix and repair rounds later, so that v2 can reduce manual loops without rewriting the v1 state model.

35. As a future user, I want task surfaces such as Kanboard, Linear, or GitHub Issues to be replaceable adapters, so that the core Task model is not coupled to one board.

## Implementation Decisions

- V1 is repo-scoped.

- One Task belongs to one repository, one branch, and one PR.

- Multi-repo work is represented as multiple repo-scoped Tasks, not one cross-repo Task.

- V1 Task states are `todo`, `implementing`, `validating`, `needs_input`, `ready`, and `done`.

- Task creation always starts in `todo`.

- `by task start` moves `todo` to `implementing` and is idempotent for an already implementing Task.

- `by submit` is allowed from `implementing` and `needs_input`.

- `by submit` creates one Run.

- There is no public Submission ID in v1.

- A Run validates one commit SHA.

- A new commit creates a new Run.

- First submit binds the Task to the current branch.

- Later submits must use the same branch.

- V1 requires the code to already be committed on a non-protected task branch.

- V1 does not create, move, reset, or repair branches.

- V1 always publishes through a GitHub PR.

- V1 does not support validated-without-PR mode.

- V1 does not merge PRs.

- `ready` means the PR is clean and waiting for human merge.

- `done` means But Why? has observed that the PR was merged.

- V1 validation is synchronous inside `by submit`.

- V1 has a repo-local daemon for PR reconciliation only.

- The daemon does not process new submissions in v1.

- But Why? uses fixed Validation Gate phases instead of a generic CI pipeline language.

- Planned v1 phases are preflight, checks, intent review, quality review, publish PR, and watch PR.

- Repo config fills these phases but does not reorder them.

- Checks run before reviewer agents to save tokens.

- Checks are repo-owned commands.

- V1 checks run sequentially and stop on first failure.

- A failed check creates a blocking Finding.

- Reviewer roles are configurable and are not fixed by the architecture.

- Intent review runs before quality review.

- Quality reviewer grouping can be configured later without changing the core model.

- Reviewer output is JSON validated with Effect Schema.

- Sandcastle should handle structured output retry.

- V1 Finding fields are title, description, severity, evidence, files, and artifact references.

- Severity values are critical, high, medium, and low.

- All v1 Findings are blocking.

- Any Finding moves the Task to `needs_input`.

- V1 does not create follow-up Tasks from validation.

- V1 has no auto-fix or repair phase.

- V1 validation phases must not modify the submitted branch.

- Phase and Round records still exist so later repair rounds can fit the model.

- Findings are stored on Runs and shown through Task-oriented commands.

- Comments are freeform Task Context, not validation results.

- Task Context includes title, description, and comments.

- V1 records token usage, not dollar cost.

- Token usage is tracked per producer and model.

- Token buckets are input, cached input, output, and total.

- Repo config stores validation behavior.

- Global config stores user defaults such as agent profiles and sandbox defaults.

- Agent profiles use `agentRuntime` and `agentModel`.

- Agent config precedence is reviewer inline setting, repo profile, global profile, then error.

- Repo init may succeed without agent profiles.

- Submit fails during preflight if a required reviewer profile cannot be resolved.

- Git facts such as base branch, remote, GitHub repository, and GitHub auth are detected at runtime.

- V1 submit fails during preflight if a GitHub PR target cannot be detected.

- CLI output is structured output on stdout.

- TOON is the default stdout format for AXI-style agent shell use.

- JSON is supported for programmatic CLI consumers.

- Command handlers return structured result objects before serialization.

- Domain modules do not depend on TOON or JSON.

- Progress and diagnostics go to stderr.

- Effect is used for orchestration.

- Effect Schema is used for schemas and validation.

- Sandcastle is the intended v1 execution engine pending spike.

- Sandcastle should be wrapped only at But Why domain seams.

- But Why should not reimplement agent process execution, sandbox lifecycle, command execution, worktree handling, structured agent-output retries, raw stream parsing, generic log capture, GitHub API mechanics, test environment setup, or observability export.

## Testing Decisions

- The highest test seam is the CLI behavior observed by a user or agent.

- CLI tests should assert external behavior, state changes, structured output, and durable records.

- Core state transition tests should cover valid and invalid transitions without going through process execution.

- Validation Gate tests should use fake Sandcastle adapters where possible.

- The Sandcastle spike must use the real dependency before production implementation starts.

- Reviewer output tests should use golden fixtures for task context, diff, and expected findings behavior.

- Check failure tests should prove that failed commands become blocking Findings.

- Submit tests should prove that task branch binding is enforced after first submit.

- Run tests should prove that each submit creates a commit-bound Run.

- Finding tests should prove that any Finding moves the Task to `needs_input`.

- PR tests should use fake GitHub adapters for most behavior and a small number of real smoke tests later.

- Daemon tests should verify reconciliation from ready to done and ready to needs input.

- Token accounting tests should verify separate aggregation of input, cached input, output, and total tokens per producer and model.

- Tests should avoid asserting internal Sandcastle implementation details.

- Sandcastle-specific tests should live at the adapter seam and prove only the behavior But Why depends on.

## Out of Scope

- Auto-fix or repair rounds.

- A full worker daemon that processes submissions.

- Direct push or gate-remote triggers.

- Webhook reconciliation.

- Kanboard, Linear, or GitHub Issues task surfaces.

- A local web board UI.

- Multi-repo workspace Tasks.

- Validation without PR publishing.

- Dollar cost calculation.

- Screenshots, videos, and proof artifacts beyond ordinary logs and structured artifacts.

- Generic CI pipeline authoring.

- Implementing the code factory inside v1.

## Further Notes

The first implementation work should be the Sandcastle spike.

If the spike fails, the execution plan should be revisited before building product code.

The current architecture is intentionally conservative about automation.

V1 routes all Findings to human input and uses explicit resubmission as the retry boundary.

This keeps the workflow understandable while preserving room for v2 repair rounds and a full worker daemon.
