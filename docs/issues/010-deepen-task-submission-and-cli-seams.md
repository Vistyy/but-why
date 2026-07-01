# Deepen Task, submit preflight, and CLI result seams

## Status

Done.

## Parent

`docs/prd.md`

## What to build

Deepen the three architecture seams found after issue 009.

Do this after Run creation from submit preflight and before validation workspace work starts.

This issue should not add new user-facing commands.
It should preserve the behavior delivered by issues 001 through 009 and the JSON output behavior from issue 022.
The goal is not cosmetic file movement.
The touched module names should follow the global naming rule in `docs/architecture.md`: use domain names, not `Module` suffixes.
Rename `taskModule.ts` to `repoTasks.ts` and `submitModule.ts` to `submitPreflight.ts` as part of the deepening.
The goal is to turn shallow modules into deeper modules with smaller interfaces, better leverage, and better locality before the Validation Gate grows.

Deepen Task durable state first.
Task and Run durability should sit behind one durable state module whose interface speaks in Task and Run terms.
That module should hide SQLite and migrations.
It should concentrate Task branch binding persistence, Run ID allocation, active Run uniqueness, Task state mutation, transactions, and row validation.
Submit preflight decides whether a Run should exist.
Task durable state persists the Task and Run changes in one local transaction.
Submit code should not duplicate Task state validation or know the SQL details required to persist a Run.
Tests should set up Task and Run scenarios through the same durable state interface that callers use, not through raw SQLite or transition backdoors that expose implementation details.

Deepen submit preflight second.
Submit preflight should speak in But Why? terms: Run created or preflight rejection.
Git facts, protected branch policy, GitHub PR Target detection, current branch safety, and durable mutation ordering should be concentrated behind one submit preflight module.
Git and GitHub details may stay in separate files, but they should be internal helpers behind the submit preflight module.
Rename `gitPreflight.ts` to `gitFacts.ts` if it remains as a separate helper.
Process calls to `git` and `gh` may remain behind internal adapters where tests need them, but those adapters should not become a generic execution seam.
Do not move Validation Gate execution into this module.
Sandcastle execution remains behind later But Why? domain seams such as `createValidationWorkspace`, `runCheckRound`, and `runReviewerRound`.

Deepen CLI result construction third.
Programmatic CLI Consumer result construction should be consistent across Task, submit preflight, and future commands.
Concentrate module-load error mapping, structured usage errors, structured runtime errors, help shape, success result construction, and serializer-facing result objects behind a small `cliResults` interface.
Name the new CLI result code with a domain name such as `cliResults.ts`, not `cliResultModule.ts`.
The serializer seam from ADR-0003 must stay intact.
Domain modules must not import TOON or JSON serializers.

## Design decisions

Task durable state is the top priority because submit preflight depends on Task and Run durability.
Submit preflight is second because validation workspace creation should receive a clear Run result model.
CLI result construction is third because more commands are about to be added and route-local error shaping will otherwise spread.

SQLite is local-substitutable and should stay behind the durable state module.
Git and GitHub CLI calls are external process dependencies and should be represented as internal adapters only where tests need substitution.
CLI result construction is in-process and should not introduce adapters.

One adapter is not enough reason to expose a seam.
If a seam exists only for tests, keep it internal to the deeper module unless production and test behavior both justify it.

## Acceptance criteria

- [x] Existing `by init`, `by`, `by task create`, `by task list`, `by task show`, `by task context`, `by task comment`, `by task start`, and `by submit` behavior is preserved.
- [x] Existing TOON stdout shape, error codes, exit codes, and help text remain unchanged unless an intentional output contract update is documented in this issue.
- [x] Existing JSON stdout shape, error codes, exit codes, and help text remain supported through the serializer seam from ADR-0003.
- [x] Task and Run durability sit behind one durable state module interface that speaks in Task and Run terms and hides SQLite and migrations.
- [x] Submit code no longer duplicates Task state validation logic.
- [x] Submit code no longer owns SQL details for branch binding persistence, active Run uniqueness, Run ID allocation, or Task state mutation.
- [x] Task branch binding persistence, Run persistence, and Task state mutation happen inside one local transaction.
- [x] Tests set up Task and Run scenarios through the durable state module interface or CLI behavior, not raw SQLite mutation.
- [x] Submit preflight returns a domain result that distinguishes Run created, preflight rejection, and tooling error.
- [x] Git facts, protected branch policy, and GitHub PR Target detection are concentrated behind the submit preflight module interface.
- [x] Git and GitHub helper files, if kept, are internal to submit preflight and are not used by other callers.
- [x] Git and GitHub process substitution used by tests is internal to submit preflight and does not become a generic execution seam.
- [x] Submit preflight does not run checks, create validation workspaces, call Sandcastle, publish PRs, or watch PRs.
- [x] CLI routes share one result construction path for success, structured usage errors, structured runtime errors, and module-load errors.
- [x] New CLI result code uses a domain name such as `cliResults.ts`, not a `Module` suffix.
- [x] CLI route code keeps argument parsing at the edge and delegates domain behavior to Task and submit preflight modules.
- [x] Domain modules do not depend on TOON, JSON, or stdout formatting.
- [x] Old shallow helper paths are removed once the deeper modules replace them.
- [x] `taskModule.ts` is renamed to `repoTasks.ts` and callers use the new path.
- [x] `RepoTaskModule` is renamed to `RepoTasks` or another domain name without the `Module` suffix.
- [x] `submitModule.ts` is renamed to `submitPreflight.ts` and callers use the new path.
- [x] `RepoSubmitModule` is renamed to `RepoSubmitPreflight` or another domain name without the `Module` suffix.
- [x] Other touched file names, type names, and exported names follow the `docs/architecture.md` rule to use domain names instead of `Module` suffixes.
- [x] `gitPreflight.ts` is renamed to `gitFacts.ts` if kept as a separate helper.
- [x] `submitStore.ts` is deleted or reduced to a non-domain adapter with no Task state rules, branch binding rules, Run ID allocation, or active Run policy.
- [x] Existing golden CLI behavior tests stay green for TOON and JSON output.
- [x] New module tests cover only the new public seams and do not test removed internals.
- [x] `just quality` passes after the refactor, including format check, lint, typecheck, and tests.
- [x] A short module-level note documents which modules future validation workspace work should call for Task durability, submit preflight, and CLI result construction.

## Blocked by

- 009-create-runs-from-submit-preflight.md
- 022-support-json-cli-output.md
