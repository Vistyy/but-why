# Introduce TaskAuthority and SubmissionEnvironment

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Split submission validation orchestration into two explicit seams.

`TaskAuthority` is the seam for Task truth.
It hides where authoritative Task content, lifecycle state, readiness, validation start, and tooling-failure recovery are stored or coordinated.

`SubmissionEnvironment` is the seam for the submitted code candidate and repo or runtime facts.
It hides whether the submission comes from a local checkout, CI, or a remote environment.

The local v1 implementation should make this distinction explicit without changing submit behavior.

Local Tasks remain backed by `.but-why/state.sqlite`.

Local submission still runs from the current checkout.

Submit should coordinate the two seams without knowing SQLite store wiring or repo-local adapter details.

## Design direction

`TaskAuthority` should own Task-authoritative behavior:

- Task ID resolution where it depends on the Task Authority.
- submit readiness reads.
- validation start as seen by submit.
- validation tooling failure recovery as seen by submit.

For local v1, `TaskAuthority` should delegate validation start and tooling-failure recovery to `ValidationRuns` instead of replacing that lower seam.

`SubmissionEnvironment` should own candidate-code behavior:

- current branch and commit facts.
- worktree cleanliness checks.
- GitHub PR target detection.
- Validation Workspace preparation.

`SubmissionEnvironment` should not own validation history.
Validation history belongs to Runs through `RunStore` and `ValidationRuns`.

The local adapters should use explicit local names, such as `LocalTaskAuthority` and `LocalSubmissionEnvironment`.

Avoid `Repo*` names when the meaning is local Task Authority or local checkout environment.

Avoid generic `Backend` names because task authority and submission environment vary independently.

## Acceptance criteria

- [ ] A `TaskAuthority` seam exists in product language.
- [ ] A local Task Authority adapter owns local Task reads, submit readiness, validation start, and validation tooling failure recovery.
- [ ] A `SubmissionEnvironment` seam exists in product language.
- [ ] A local Submission Environment adapter owns current-checkout Git facts, GitHub PR target detection, and Validation Workspace setup.
- [ ] Submit CLI does not import SQLite store wiring.
- [ ] `repoSubmit` naming is removed or replaced with local Task Authority and local Submission Environment naming.
- [ ] Existing submit CLI output and structured errors remain unchanged.
- [ ] Existing submit behavior remains unchanged.
- [ ] Tests cover submit behavior through the new seams.
- [ ] Fallow boundary rules enforce the new seams.
- [ ] The Fallow score floor is raised to `88` if the quality gate passes cleanly.

## Blocked by

None.
