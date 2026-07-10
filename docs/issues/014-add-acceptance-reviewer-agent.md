# Add acceptance reviewer agent

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run the mandatory Acceptance Reviewer through a shared Sandcastle reviewer runner after checks pass.

The Acceptance Reviewer determines the intended result from the Task Context Snapshot and judges whether the submitted implementation achieves that result fully and correctly.
A Finding records anything missing, incorrect, or too unclear to judge.
An empty Findings list means Acceptance Review passed.

But Why? provides this default responsibility prompt:

```text
Determine the intended result from the Task Context Snapshot.

Inspect the submitted implementation and relevant repository context.

Judge whether the intended result was implemented fully and correctly.

Report a Finding for anything missing, incorrect, or too unclear to judge.
Return no Findings only when the implementation achieves the intended result.
```

The default prompt supplies responsibility rather than repeating project knowledge.
The coding agent inspects repository documentation, trusted project instructions, skills, code, and tests inside the Validation Workspace.

A repository may replace the default prompt completely through the direct `review.acceptance.instructionsFile` override.
But Why? still owns the execution wrapper, review inputs, trust boundaries, and structured output contract.

The shared reviewer context introduced here is available to every reviewer role.
It includes the Task Context Snapshot, the submitted commit SHA, the fixed comparison base SHA, and a clean view of the submitted code.
The comparison base is the merge base between the submitted commit and the configured base branch when the Validation Run starts.

## Acceptance criteria

### Phase and responsibility

- [ ] The canonical phase and role names are `acceptance_review` and Acceptance Reviewer across domain records, storage, config, CLI output, docs, and tests.
- [ ] Acceptance Review is a mandatory Validation Gate phase.
- [ ] Acceptance Review runs only after prepare and checks pass.
- [ ] Acceptance Review runs before configurable Quality Reviewers.
- [ ] Acceptance Review runs inside the Validation Workspace, not the user's checkout.
- [ ] The default prompt matches the approved responsibility prompt in this issue.
- [ ] Acceptance Review reports only problems that make the intended result missing, incorrect, or too unclear to judge.
- [ ] Style, simplicity, and general quality concerns outside the intended result remain Quality Review concerns.
- [ ] Unclear or contradictory Task Context produces a Finding rather than a guessed intent.

### Shared reviewer context

- [ ] The Validation Run stores the submitted commit SHA and the fixed comparison base SHA.
- [ ] The comparison base is the merge base between the submitted commit and the configured base branch captured when the Validation Run starts.
- [ ] Every reviewer receives the fixed comparison base SHA, submitted commit SHA, and Task Context Snapshot through one shared reviewer context.
- [ ] Acceptance Review starts with a clean view of the submitted commit after checks finish.
- [ ] Check or prepare leftovers cannot be mistaken for submitted code.
- [ ] The reviewer can inspect repository documentation, trusted project instructions, skills, code, and tests through the Validation Workspace.
- [ ] The execution wrapper marks Task Context and ordinary repository content as material to review rather than commands to follow.

### Prompt and profile resolution

- [ ] But Why? provides the default Acceptance Reviewer prompt without requiring repo config.
- [ ] Global setup can provide the default harness profile used by Acceptance Review.
- [ ] Repo config may override Acceptance Review directly at `review.acceptance`.
- [ ] `review.acceptance.profile` may select a different Agent Profile.
- [ ] `review.acceptance.instructionsFile` completely replaces the default responsibility prompt.
- [ ] A replacement prompt is resolved from the submitted commit.
- [ ] A missing, unreadable, or invalid replacement prompt fails preflight with a structured typed config error.
- [ ] Submit fails preflight with a structured typed config error when no usable harness profile can be resolved.

### Execution and output

- [ ] One shared Sandcastle reviewer runner dispatches to the adapter selected by the resolved Agent Profile.
- [ ] The shared runner is not hard-coded to Pi.
- [ ] Reviewer output contains only `findings`; an empty list is the passing result.
- [ ] Reviewer output is JSON validated with Effect Schema.
- [ ] But Why? supplies structured output instructions from the reviewer output contract instead of duplicating schema prose in replaceable prompts.
- [ ] Sandcastle structured output retry is used instead of a custom retry loop.
- [ ] Invalid reviewer JSON after Sandcastle retry is exhausted is recorded as a typed Reviewer Output Contract Failure.
- [ ] Runtime and other reviewer tooling failures remain separate from Findings.
- [ ] Valid reviewer Findings are stored on the Validation Run.
- [ ] Any Acceptance Finding moves the Task to `needs_input`.
- [ ] Empty Findings allow validation to continue.
- [ ] Reviewer structured output and execution logs are stored as Validation Run artifacts.
- [ ] Token usage is attributed to the Acceptance Reviewer producer, harness, and model when the harness supplies it.
- [ ] Missing harness token usage is represented as unavailable without inventing values or failing the review.

### Code tests

- [ ] Code tests cover phase ordering, mandatory execution, and clean continuation.
- [ ] Code tests cover Findings moving the Task to `needs_input`.
- [ ] Code tests cover Task Context ambiguity producing a Finding.
- [ ] Code tests cover shared reviewer context construction and fixed comparison SHAs.
- [ ] Code tests cover clean reviewer workspace setup after mutating checks.
- [ ] Code tests cover default prompt and direct repo overrides.
- [ ] Code tests cover missing override files and unresolved harness profiles as preflight errors.
- [ ] Code tests cover Sandcastle adapter dispatch without hard-coding one harness.
- [ ] Code tests cover structured output retry and exhausted retry as a typed tooling failure.
- [ ] Code tests cover Findings, tooling failures, artifacts, and token availability as separate records.

Model output quality is measured by `docs/issues/021-build-reviewer-model-eval-harness.md`.

## Blocked by

- `docs/issues/049-configure-default-agent-harness-during-setup.md`
