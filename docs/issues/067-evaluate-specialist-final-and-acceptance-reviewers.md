# Evaluate Specialist, Final, and Acceptance Reviewers

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Build a repeatable model evaluation harness for Specialist, Final, and Acceptance Reviewer judgment using small real repositories and human-reviewed expected results.
Measure reviewer quality without duplicating orchestration tests.

## Acceptance criteria

- [ ] Fixtures contain fixed Git states, repository guidance, optional Acceptance Context, and human-reviewed expected results.
- [ ] Suites cover correct changes, seeded defects, whole-change interactions, Specialist boundaries, and missing or conflicting intent.
- [ ] Objective checks and a separate pinned grader score decision correctness, Finding coverage, precision, evidence, and output validity.
- [ ] Runs retain reviewer prompt, policy, harness, model, grader, fixture version, outputs, scores, and reasons.
- [ ] Default repetition and calibrated passing thresholds detect unstable prompt or model changes.
- [ ] Specialist, Final, and Acceptance Reviewer results can be compared independently.
- [ ] Evals do not require live PR publication.

## Blocked by

- `docs/issues/056-run-selective-specialist-reviewers.md`
- `docs/issues/059-add-final-gates-and-expose-validate.md`
