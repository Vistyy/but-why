# Test suite consolidation plan

## Status and purpose

Status: Active investigation authorized by the Operator.

This temporary planning artifact records the evidence, decisions, and unresolved questions for consolidating the But Why test suite.
It is planning context rather than product documentation, implementation authority, an approved specification, or authorization to change tests.
The investigation will keep this artifact current across long sessions and derive Tasks only after the affected test portfolios and overlapping work are understood.

Remove this plan after the Operator accepts the resulting work split and every accepted requirement is represented in an authoritative Task, current documentation source, or ADR.

## Required outcome

Make the maintained test suite smaller, faster, and easier to change while preserving the distinct protection required by accepted behavior and material risks.
Reduce total test cases, files, fixture concepts, setup paths, subprocesses, Git operations, SQLite initialization, and repeated assertions where they do not protect a distinct fact.
Organize retained evidence around the responsibility that owns the behavior rather than around the historical sequence in which features and defects were added.

A proposed consolidation is better only when it preserves the same required confidence at a cheaper reliable seam and reduces the complete maintenance or execution cost of the affected portfolio.
Line reduction, helper reuse, fewer files, and faster execution are measurements rather than independent goals.

## Authorities and constraints

`VERIFICATION.md` defines the material risks and project-specific evidence constraints.
`docs/tooling.md` defines check ownership and the supported contributor workflows.
`docs/architecture.md` and the context documents define domain and module ownership.
`plans/system-simplification-plan.md` supplies overlapping implementation-simplification context but does not authorize test changes.

Retain real SQLite evidence for distinct atomicity, supported migration, and persisted Shared Repository State contracts.
Retain real Git evidence for distinct identity and work-preservation contracts.
Use a real process only when package, executable, stdin, process-tree, or agent-runtime behavior is at issue.
Retain the shared capacity lock and three-worker Vitest limit unless a future Candidate supplies the evidence required by `VERIFICATION.md`.
Do not weaken exact Acceptance Context, Candidate, Validation Run, external-target, cleanup, or terminal-result identity protection.
Do not make private implementation seams public or replaceable only to simplify a test.

## Scope

The investigation covers all of the following connected structures.

- Test portfolio ownership and the allocation of behavior, contract, boundary, and failure evidence across files.
- Suite and file boundaries, including fragmented suites that protect one responsibility and oversized suites that combine materially different responsibilities.
- Shared harnesses for disposable repositories, Git, SQLite, CLI execution, Agent Sessions, reviewer workflows, validation, publication, cleanup, and external-system fakes.
- Repeated setup, lifecycle construction, persisted-state fixtures, corruption operations, clocks, policies, identifiers, and expected records.
- Scenario tables and assertion helpers where cases differ only by inputs and expected classification.
- Execution topology, including repeated subprocess startup, repeated scans, avoidable repository initialization, and setup that can be safely shared within one isolation boundary.
- Production seams and dependency injection retained only for tests, where the system simplification initiative may remove the source of test setup cost.

The investigation does not assume that every repeated block should become a helper.
A shared harness must concentrate stable mechanics or invariants without hiding the policy and assertions that make a test understandable.
A universal configurable fixture is not the target.

## Decision rules

Evaluate a group of tests as one responsibility portfolio before deleting or extracting individual cases.
Name the owner, supported interface, protected facts, required boundary, and failure class for every retained evidence group.
When checks overlap, retain the cheapest reliable owner seam plus every distinct material boundary fact.
Keep an expensive boundary test only when replacing that boundary would stop the test from establishing its protected fact.
Consolidate setup only when the consumers share its lifecycle, invariants, and cleanup semantics.
Keep policy choices and consequential assertions visible at the test site even when mechanics move into a harness.
Prefer a small owner-specific fixture vocabulary over option bags that can construct invalid or irrelevant states.
Treat a second fixture or decoder for the same durable meaning as a trigger to inspect ownership rather than automatic evidence for a generic abstraction.
Remove the replaced setup path after all current consumers migrate.
Measure the affected portfolio before and after each proposed change.

## Working method

1. Reconcile active Tasks, Changes, and planning work before defining a portfolio candidate.
2. Inventory the files, helpers, setup paths, expensive boundaries, and direct production seams used by one responsibility.
3. Map each current test to the exact supported fact or material failure it protects.
4. Identify repeated evidence, setup, assertions, and execution that lack a distinct protection claim.
5. Design the smallest retained portfolio and the narrow fixtures or harnesses it needs.
6. Compare at least the current structure, deletion without replacement, and the credible consolidated structure.
7. Verify the proposed portfolio against `VERIFICATION.md` and the applicable domain authority.
8. Record expected file, line, test-count, subprocess, Git, SQLite, and duration changes when measurable.
9. Derive an independently assessable Task only after the portfolio and its overlap with other work are stable.

## Baseline inventory

The current checkout contains 103 `*.test.ts` files and approximately 37,513 lines in those files.
All TypeScript under `test/`, including support code, contains approximately 39,920 lines, while production TypeScript under `src/` contains approximately 35,445 lines.
A lexical inventory finds 671 direct `it` or `test` declarations and 93 `describe` declarations.
Parameterized cases expand beyond those declarations, and the most recent complete Vitest run observed during this investigation reported approximately 953 tests in approximately 100.6 seconds.
These measurements are a volatile comparison baseline rather than acceptance thresholds.

The suite has 21 files under `test/change`, 19 under `test/repository`, 13 under `test/agent`, 12 under each of `test/validation`, `test/task`, and `test/cli`, and smaller publication, configuration, command, support, and submission groups.
The ten largest test files contain approximately 13,166 lines, led by publication policy, Change Submit orchestration, GitHub pull-request behavior, Task Review submission, and Candidate Validation inspection.

The current support directory contains focused helpers for process execution, workspaces, Git cleanup, CLI execution, initialized repositories, Candidate-ready repositories, SQLite state, Change ports, validation ports, Candidate capture, Change implementation, Change inspection, Task use cases, Terminal Cleanup, and Herdr fakes.
At least 42 test files import `testWorkspace`, 30 import `by-cli`, 29 import `testProcess`, and 19 import the repository SQLite support module.
At least 24 test files use temporary-repository concepts, 32 mention SQLite capabilities or Adapters, and 41 contain Git-related setup or assertions.
These counts identify investigation areas but do not establish that the current uses are redundant.

## Shared setup topology

`createTestWorkspace` is the base disposable-filesystem owner and appears in 37 test files with approximately 156 references.
Its cleanup removes both the workspace and sibling paths created by Managed Worktree behavior, so replacing it with a generic temporary-directory helper would lose a current safety responsibility.

`createGitRepo` adds only `git init` over that workspace, while `createInitializedRepo` invokes the source CLI to create Repo Config and Shared Repository State.
`candidateReadyRepo` builds on initialized state, creates a branch and remote shape, and directly inserts a Change into SQLite.
These helpers represent materially different repository states and should not be collapsed merely because they form a setup chain.
The investigation should instead test whether their names and returned facts make those states explicit and whether suites reconstruct any of the same states locally.

`runByInProcessEffect` appears in 18 test files with approximately 241 references and accepts optional Task, Task/Change coordination, cancellation, reviewer, Underengineer, Interactive Session, stdin, clock, global-config, and stderr dependencies.
This broad test seam is an important source of flexible setup, but `plans/system-simplification-plan.md` separately questions whether broad CLI injection objects preserve production seams used only by tests.
Do not create a more elaborate fixture around that interface before the production simplification decision establishes which inputs remain.

`withTemporaryRepositoryState` appears in 13 files with approximately 62 references and owns a focused real-SQLite lifecycle without requiring a Git repository.
`createInitializedRepo` and `candidateReadyRepo` serve different contracts because they include actual CLI initialization and Git identity.
Portfolio work should preserve that distinction while consolidating repeated owner record construction within the SQLite-only suites.

`runTestProcess` creates an isolated HOME, temporary directory, and XDG directory tree for every invocation in addition to launching the child process.
Batching repeated tool invocations therefore removes filesystem setup and cleanup as well as process startup.
At least 15 test files call `runTestProcess` and at least 15 call `runTestProcessOrThrow`, while real subprocess use must remain limited to the boundaries named by `VERIFICATION.md`.

Several suites define a local generic `git` wrapper over `runTestProcessOrThrow`, and `candidateReadyRepo` exports another generic wrapper.
This repetition is small and does not by itself justify a shared generic Git helper because named repository-state operations may provide a more truthful and smaller test interface.

## Existing work and overlap

Open Change `BY-C61` implements Task `BY-68`, "Stop and await long-running test processes."
Do not propose process-helper or process-lifecycle consolidation until its merged result is inspected and the overlap is reconciled.

`plans/system-simplification-plan.md` already identifies verification setup caused by broad use-case objects, callback loaders, fixed-storage ports, construction-only Effect services, Layer topology, and test-only production flexibility.
This plan must distinguish consolidation possible within the current production structure from setup that should disappear only when an accepted production simplification removes the seam.

No current open Task directly authorizes the test-suite consolidation initiative.
Create no implementation Task until its portfolio entry identifies the retained evidence and the complete removal or consolidation boundary.

## Portfolio ledger

Each portfolio remains provisional until its protected facts and current tests have been mapped.

| Portfolio | Current evidence | Consolidation question | Required boundary | Overlap | Status |
| --- | --- | --- | --- | --- | --- |
| Repository-authored tooling diagnostics | `test/repository/tooling-diagnostics.test.ts` runs 20 ast-grep sensitivity cases through a separate package-manager and ast-grep process, with a new fixture root and copied configuration for each case. | Can one generated fixture repository and one ast-grep scan preserve rule identity and actionable diagnostic assertions while eliminating repeated startup and copying? | A real ast-grep process is required to establish repository tool behavior, but one process per rule is not justified by the observed result. | Tooling ownership in `docs/tooling.md`. | Bounded feasibility and performance probe supports consolidation; Task shaping remains. |
| Reviewer execution and judgment mechanics | Acceptance, Specialist, Candidate, and Task Review suites repeat Agent runtime, output decoding, retries, Findings, and settlement scenarios across several large files. | Which mechanics are shared Agent Session or reviewer-execution contracts, and which policies, prompts, lifecycle results, and persistence facts remain owner-specific? | Real processes are required only for agent-runtime behavior; most classification and orchestration evidence may use captured Adapters. | Consolidation reviewer and Agent Session ownership work. | Initial evidence from prior audit; mapping required. |
| SQLite persisted-state contracts | At least 32 test files use SQLite-related capabilities, while `withTemporaryRepositoryState` supplies one common real-SQLite lifecycle and many suites construct owner records independently. | Can decoder corruption cases, owner state builders, and transaction fixtures be consolidated without replacing distinct operation-specific malformed-state or atomicity evidence? | Real SQLite is required for persisted behavior, migrations, and atomicity. | `plans/system-simplification-plan.md` requested-projection and state-kernel decisions. | Inventory started. |
| Disposable repository and Git setup | `createInitializedRepo`, `candidateReadyRepo`, `createGitRepo`, `createTestWorkspace`, and suite-local Git helpers form overlapping setup chains used across many files. | Which repository states are stable named fixtures, which setup belongs to a specific owner, and which Git operations or clones can be removed or shared safely? | Real Git remains required for identity and work preservation. | BY-C61 may change process cleanup; package isolation has stricter independent-state requirements. | Inventory started. |
| CLI and installed-package contracts | Approximately 30 files import `by-cli`; 18 test files use `runByInProcessEffect`, while the module also exposes source-process, built-process, Just, initialization, and Task Review paths. | Can command selection and response assertions remain at cheaper operation or in-process seams while retaining a small set of process and package sentinels, and which injected dependencies disappear with production simplification? | Real process and disposable installation remain required for executable, package, stdin, and installed-isolation facts. | Release-readiness Tasks BY-14, BY-15, and BY-17 plus the broad CLI injection decision in the system simplification plan. | Mapping required; defer consequential changes until release overlap is clear. |
| Change workflow fixtures | Several of the largest files independently assemble Change, Candidate, validation, publication, cleanup, and external Adapter state. | Can owner-specific scenario builders make lifecycle states explicit while removing repeated records, policy bags, timestamps, and unused port methods? | The boundary varies by protected fact and must be mapped per operation. | System simplification may delete broad ports and loaders that fixtures currently reproduce. | Mapping required. |
| Timed commands and process lifecycle | Command timeout, cancellation, process-group settlement, and observation mechanics appear across command, reviewer, validation, cleanup, and repository tests. | Which suite owns each process-lifecycle fact, and which callers need only a captured command result? | A real process is required for actual process-tree and signal behavior. | Active BY-C61/BY-68. | Blocked on overlap inspection. |
| Exact duplicate and table-shaped scenarios | Prior sampling found repeated decoder, blocker, scheduling, and policy cases, while many suites repeat the same setup around one varying input. | Which cases protect identical facts and can be deleted or represented by one visible scenario table? | Use the cheapest seam that still exercises the owner contract. | May be absorbed into every portfolio rather than one Task. | Cross-cutting inventory required. |

## First bounded candidate: tooling diagnostics

The current ast-grep sensitivity table creates 20 separate temporary repositories, copies the same rule and configuration files, writes one focused source file, and launches `pnpm exec ast-grep scan` once per row.
The protected facts are that every configured rule detects its representative prohibited form and emits an actionable policy diagnostic.
Those facts do not require process isolation between rows.

A bounded probe measured the existing focused block at 20 passing cases in 9.71 Vitest seconds and 10.376 wall-clock seconds.
A disposable combined fixture containing the same 20 prohibited forms completed one unfiltered ast-grep scan in 0.368 wall-clock seconds.
The combined scan emitted 22 diagnostics covering all 20 fixture files and expected rule identities.
Two fixtures correctly matched both applicable JSON parsing rules, so the consolidated assertion must check expected rule-and-file pairs rather than require exactly one diagnostic per fixture.
The probe reduced ast-grep process launches from 20 to one and observed approximately a 96 percent wall-clock reduction for the scanned block.
The timing came from one run of each form on the same checkout, so it establishes the dominant startup cost but not a stable benchmark distribution.

The supported consolidated design creates one fixture repository containing one uniquely named file per table row, runs one unfiltered ast-grep scan, decodes diagnostics by rule ID and file, and asserts that every expected pair is present and actionable.
The file names and expected pairs prevent one defect from accidentally satisfying another row, while directory placement and file extensions preserve the configured `src`, `test`, `extensions`, `scripts`, TypeScript, and JavaScript coverage.
The portfolio should retain separate Effect diagnostic, Biome plugin, health-report, recipe, and shell-script cases unless their own evidence shows additional safe batching.

The installed ast-grep version supports `--json=compact --include-metadata` and returns `ruleId`, `file`, `severity`, and `message` fields suitable for the required assertions.
Before Task extraction, define the smallest focused output decoder and state the exact focused verification.

## Required portfolio record

Every mature portfolio entry must contain the following evidence before it becomes a Task.

- The responsibility and authoritative owner.
- Every current file and helper in scope.
- The supported facts and material failures protected by the current tests.
- The distinct facts that require real SQLite, real Git, a real process, package installation, or another expensive boundary.
- Repeated evidence that can be deleted without replacement.
- Repeated mechanics that should move into an owner-specific fixture or harness.
- The proposed retained suite structure and representative readable test.
- The production seams or test-only flexibility that the proposal retains, removes, or leaves to another accepted simplification.
- Existing Tasks, Changes, plans, and release work that overlap.
- Baseline and expected test count, file count, line count, expensive-operation count, and duration.
- Focused verification that would establish the consolidated portfolio itself.

## Task extraction rules

Prefer one Task per coherent responsibility portfolio or independently verifiable shared harness migration.
Do not create a repository-wide "clean up tests" Task.
Do not split helper extraction from consumer migration when either half would leave parallel setup paths.
A Task must name the evidence retained, the setup or cases removed, the boundary costs reduced, and the focused verification required.
A Task that depends on a production simplification must follow or join that work rather than preserve the obsolete seam in a new test helper.

## Unresolved questions

- Which responsibility portfolios account for most of the approximately 100-second runtime after subprocess-heavy tests are separated from CPU and SQLite work?
- Which large files are cohesive portfolios, and which combine responsibilities that should remain separately owned?
- Which existing support helpers overlap semantically rather than only sharing filesystem or Git syntax?
- Where does shared setup preserve safe isolation, and where would reuse introduce ordering, mutation, or cleanup coupling?
- Which direct CLI tests protect presentation and routing contracts that cannot be established through application operations?
- Which fixture complexity will disappear through the operation-first production architecture, and which consolidation is worthwhile beforehand?
- What is the smallest useful set of test-suite metrics that can be measured reliably without adding permanent tooling?

## Investigation log

- Established the initial suite size, directory distribution, largest files, support-helper usage, and broad Git, SQLite, process, and temporary-repository footprints.
- Mapped the main workspace, Git repository, initialized repository, Candidate-ready repository, SQLite-only, CLI, and subprocess support layers and recorded where their lifecycle responsibilities differ.
- Confirmed that the tooling-diagnostics ast-grep table launches a fresh process and copies the same configuration for each row.
- Ran a disposable one-scan probe that preserved all 20 expected rule-and-file matches while reducing observed wall time from 10.376 seconds to 0.368 seconds and process launches from 20 to one.
- Confirmed that the installed ast-grep structured output supplies the rule identity, file, severity, and message needed for consolidated assertions.
- Reconciled current live work and identified BY-C61/BY-68 as an overlap for process lifecycle and release Tasks BY-14, BY-15, and BY-17 as constraints on package and CLI consolidation.
- Recorded the broader suite, helper, setup, and execution-topology scope requested by the Operator.
