# Split task CLI edge modules

## Status

Done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Restructure the task CLI edge so task command parsing, routing, output shaping, and error mapping are no longer concentrated in one large file.

Move task CLI code out of `src/task` and into a dedicated Task CLI Adapter under `src/cli/task`.

Split task subcommands into vertical command modules.

Each command module should keep its own argument parsing, command-specific help, use-case call, and CLI result mapping together.

Each command module should expose one narrow command runner function, such as `runCreateCommand(args, env)`.
The command runner `env` must stay narrow.
It should contain only edge dependencies the command needs, such as `TaskUseCases`, current working directory inputs, file-reading inputs, and existing CLI output format options.
Do not use `env` as a broad service locator.
Do not split one command across separate parser, handler, and renderer folders.

Keep `src/task` focused on Task domain code, Task use cases, Task storage seams, and Task-specific non-CLI adapters.

Move Task description and comment file adapters under `src/task/files` so they are distinct from domain, use-case, and CLI modules.
These are Task file adapters.
They should only translate file contents into Task text inputs.

The Task CLI Adapter translates between the AXI shell contract and `TaskUseCases`.
It owns args, help, stdout shaping, stderr diagnostics, structured errors, and exit codes.
It must continue to enter Task behavior through `TaskUseCases`.

This is a behavior-preserving refactor.

Do not introduce an external CLI framework in this issue.

A small internal argument helper is allowed only if it removes real duplication after the vertical split.

Preserve AXI behavior for stdout, stderr, structured errors, exit codes, no-args behavior, contextual help, and `--help`.

## Target shape

```text
src/cli/task/
  taskCli.ts
  dashboard.ts
  taskCliSupport.ts
  commands/
    create.ts
    list.ts
    show.ts
    start.ts
    context.ts
    comment.ts

src/task/
  task.ts
  taskId.ts
  lifecycle.ts
  startPolicy.ts
  submitPolicy.ts
  taskStore.ts
  taskUseCases.ts
  repoTaskIds.ts
  files/
    descriptionFile.ts
    commentFile.ts
```

The exact filenames may change if a clearer name appears during implementation.

The important shape is that task CLI adapter code lives under `src/cli/task`, command modules are vertical slices, and Task domain or use-case files do not depend on CLI modules.

`dashboard.ts` owns the no-args `by task` output.
`taskCli.ts` owns routing, top-level task help dispatch, and delegating no-args execution to `dashboard.ts`.

`taskCliSupport.ts` must stay mechanical and task-specific.
It may contain only Task CLI glue reused by multiple task commands, such as Task ID resolution, use-case loading, and mapping known Task errors to the existing structured CLI error contract.

## Acceptance criteria

- [x] `src/task/taskCli.ts` is removed or reduced to a moved compatibility-free implementation under `src/cli/task`.
- [x] Top-level CLI routing imports the task CLI from `src/cli/task`.
- [x] Task create, list, show, start, context, and comment commands live in separate vertical command modules.
- [x] Each task command module exposes one narrow command runner function rather than parser, handler, and renderer objects.
- [x] Command runner `env` values stay narrow and do not become broad service locators.
- [x] Dashboard or no-args task output is owned by `dashboard.ts` and separated from subcommand routing.
- [x] Shared task CLI loading, Task ID resolution helpers, and common error mapping live in a small mechanical Task CLI support module.
- [x] `descriptionFile.ts` and `commentFile.ts` move under `src/task/files` as Task file adapters.
- [x] Task CLI modules depend on `TaskUseCases` and do not bypass it for Task behavior.
- [x] Task domain and use-case modules do not import task CLI modules.
- [x] Existing task CLI stdout shape remains unchanged.
- [x] Existing task CLI structured errors and exit codes remain unchanged.
- [x] Existing task CLI `--help` and no-args behavior remain unchanged.
- [x] No external CLI framework is introduced.
- [x] Fallow boundary configuration reflects the new CLI task location if needed.
- [x] Fallow has no new boundary violations from this refactor.
- [x] If this split naturally allows the Fallow health score gate to move toward the previous `88.7` baseline, restore it.
- [x] If the previous Fallow score gate cannot be restored in this issue, document which remaining hotspots block it.
- [x] `just quality` passes.

## Implementation notes

The Fallow score gate was not restored to `88.7` in this issue.
`pnpm exec fallow health --no-production --no-cache --min-score 88.7 --score` reports health score `88.1`, which rounds to `88`, below the minimum threshold `89`.
The remaining deductions are unit size `-10.0` and coupling `-1.9`.
The blocking hotspots are the existing large submit, init, and validation orchestration seams listed by active threshold overrides in `.fallowrc.jsonc`.
This issue removed the old `src/task/taskCli.ts` threshold override and kept the current score gate at `87.8`.

## Blocked by

- `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`
