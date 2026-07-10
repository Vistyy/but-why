# Build reviewer model eval harness

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Build a model eval harness and the first Acceptance Reviewer eval suite.

The harness should measure reviewer judgment rather than repeat orchestration and schema code tests.
Each eval case uses a small real Git repository with fixed base and submitted commits, a Task Context Snapshot, and a human-reviewed expected result.
The reviewer inspects the fixture repository through the normal reviewer interface.

The harness should score decision correctness, expected-problem coverage, Finding precision, evidence quality, and output-contract validity.
Objective facts are checked in code.
A separate pinned grader model judges whether Findings match the human-reviewed problems and rubric.

Each case runs five times by default so one lucky model response cannot define prompt quality.
The run count remains configurable for faster local checks and larger benchmarks.

Pass thresholds are calibrated against human judgment and stored with the suite.
They are not guessed before the baseline is reviewed.

## Acceptance criteria

### Fixture model

- [ ] Each fixture is a small real Git repository with fixed base and submitted commits.
- [ ] Each fixture includes a Task Context Snapshot and a human-reviewed expected result.
- [ ] Each expected result defines the expected pass-or-block decision and any seeded problems.
- [ ] Each seeded problem includes enough evidence for a human to verify the answer.
- [ ] Fixture repositories can contain documentation, trusted project instructions, skills, code, and tests for normal agent discovery.
- [ ] Fixture and rubric formats are documented and versioned.

### Initial Acceptance Review suite

- [ ] The suite covers a fully correct change.
- [ ] The suite covers a missing part of the requested result.
- [ ] The suite covers implemented behavior that is incorrect.
- [ ] The suite covers unclear or conflicting Task Context.
- [ ] The suite covers an important project rule found only in repository documentation.
- [ ] The suite covers an unrelated quality concern that Acceptance Review should leave for Quality Review.

### Measurement

- [ ] Every run measures the correct pass-or-block decision.
- [ ] Every run measures coverage of human-reviewed expected problems.
- [ ] Every run measures precision by mapping each Finding to a real expected problem.
- [ ] Every run measures whether cited evidence supports the Finding.
- [ ] Every run measures reviewer output contract validity.
- [ ] Objective checks such as schema validity and cited-file existence are implemented in code.
- [ ] A separate pinned grader model evaluates semantic matches against the human-reviewed rubric.
- [ ] The reviewer does not grade its own output.
- [ ] Reviewer output, objective scores, grader output, and grader reasons are retained for human inspection.

### Repeatability and comparison

- [ ] Each case runs five times by default.
- [ ] Run count is configurable.
- [ ] Reports include per-case success rates and aggregate scores.
- [ ] Every report records reviewer prompt version, reviewer harness and model, grader model, fixture version, and run count.
- [ ] Reports distinguish results produced by different recorded setups.
- [ ] Human reviewers calibrate the grader and approve the initial baseline.
- [ ] Minimum passing scores are stored with the calibrated suite.
- [ ] A changed default prompt can be compared with the approved baseline.
- [ ] A repo's custom Acceptance Review prompt can be evaluated against the same suite.
- [ ] Evals do not require live PR publishing.

## Blocked by

- `docs/issues/014-add-acceptance-reviewer-agent.md`
