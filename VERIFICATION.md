# Verification

## Important risks

- But Why can use the wrong Task, Change, Candidate, Change Base, policy snapshot, or ownership facts.
  The wrong work can be judged, completed, or published.
- But Why can report or record a failed or incomplete operation as successful.
  Work can proceed without required evidence.
- Concurrency, interruption, or an uncertain external mutation can leave Shared Repository State inconsistent with Git, remote, or workspace facts.
  Recovery can become untrustworthy.
- Before publication, `just by` can select an executable other than the canonical main-checkout Trusted But Why Executable.
  Candidate code can then mutate Shared Repository State.

## Evidence ownership

- Supported runtime behavior: behavior tests at the supported interface.
- CLI results, exit status, TOON, and JSON: CLI boundary checks against result construction and output codecs.
- Package contents: the package contract test.
- Reader-visible command and setup behavior: documentation checks and documentation tests.
- Named architecture and structural contracts: Fallow and ast-grep.
- Local Repository identity, migrations, source-workflow isolation, and recovery boundaries: focused repository and workflow boundary checks.

## Supported mechanisms

### Focused evidence

Use `just test <focused-path-or-selection>` and focused static checks for implementation feedback.

Limits: A focused selection does not establish complete-suite behavior.
A durable automated test is not required unless accepted requirements or this strategy require one.

### Routine quality

Use `just quality` for the blocking routine tests, static checks, and production build.

Limits: The routine suite excludes `*.boundary.test.ts` and does not run coverage or slow external boundaries.

### Complete quality

Use `just full-quality` for the complete selected test suite with the same static checks and production build.

Limits: This is an expensive complete workload.
It does not establish live external-agent behavior when an applicable opt-in smoke test is skipped.

### Static and contract checks

Use `just typecheck`, `just lint`, `just format-check`, `just docs-check`, `just ast-grep-check`, and `just fallow-check` for their documented concerns.

Limits: Static, documentation, package, and structural checks do not replace runtime evidence at the supported interface.

### Change Submit

Change Submit owns the configured blocking Check and review phases.
The current Repo Config runs `just full-quality` as its blocking Check and enables the `standards` Specialist.

Limits: Focused implementation evidence does not replace Change Submit.
Implementers must not manually duplicate its broad Check or review phases.

## Mandatory gates

- `just quality`: Run the routine contributor gate for repository changes that do not use Change Submit.
- Change Submit: Run the configured Check and review phases before publication or accepted No-Change completion.

## Budgets

- Complete test, coverage, quality, and full-quality workloads use the repository capacity lock.
- Targeted test selections remain unlocked.
- `just quality` has a 10-second warning target.
- `just full-quality` has a 30-second warning target.
- These runtime targets warn but do not fail the workload.
- The project has no accepted hard stability budget.
