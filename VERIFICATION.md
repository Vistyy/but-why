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

[Tooling](docs/tooling.md#quality-ownership) defines current ownership for runtime, output, package, documentation, and structural evidence.

- Claims about Local Repository identity, Git, Shared Repository State, migrations, process ownership, source-workflow isolation, and recovery require focused boundary evidence at the real applicable seam.
- Use lower-cost behavior or static evidence for variations that do not require a real boundary.
- Use an expensive end-to-end mechanism only when integration across its complete path is part of the claim.

## Supported mechanisms

Use the commands and ownership defined in [Tooling](docs/tooling.md#supported-commands).
Use focused tests and focused static checks during implementation.
A focused selection does not establish complete-suite behavior.
Static, documentation, package, and structural checks do not replace runtime evidence at the supported interface.
A durable automated test is not required unless accepted requirements or this strategy require one.

## Mandatory gates

- For repository changes outside Change Submit, run the blocking routine contributor workflow defined in [Tooling](docs/tooling.md#supported-commands).
- During lifecycle simplification, Changed Candidate Submission must run `just quality` as its configured Check, followed by the configured review phases.
- Each simplification Task must obtain the focused evidence required by its Task Verification Contract at the cheapest reliable seam.
- For a task-backed No-Change Submission, Change Submit must run Acceptance Review without configured Checks or Specialists.
- A taskless No-Change Submission must return `nothing_to_submit` before Validation and remain open.

Change Submit owns its configured Check and review phases.
Implementers must not rerun that broad Check manually.
`just full-quality` remains a diagnostic migration tool and is not a blocking Change Submit gate.
A complete-suite result does not replace focused evidence for an affected Material Risk.

## Budgets

- Retained blocking evidence must have zero known intermittent failures.
- Complete quality, test, and coverage workloads use the repository capacity lock, while targeted test selections remain unlocked.
- The project has no accepted numerical runtime threshold.
- Existing 10-second and 30-second warnings are historical diagnostics, not accepted verification budgets.
