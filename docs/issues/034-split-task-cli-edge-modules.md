# Split task CLI edge modules

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Restructure the task CLI edge so task command parsing, routing, output shaping, and error mapping are no longer concentrated in one large file.

Move task CLI code out of `src/task` and into a dedicated CLI edge area under `src/cli/task`.

Split task subcommands into vertical command modules.

Each command module should keep its own argument parsing, command-specific help, use-case call, and CLI result mapping together.

Do not split one command across separate parser, handler, and renderer folders.

Keep `src/task` focused on Task domain code, Task use cases, Task storage seams, and Task-specific non-CLI adapters.

Move Task description and comment file adapters under `src/task/files` so they are distinct from domain and use-case modules.

The task CLI must continue to enter Task behavior through `TaskUseCases`.

This is a behavior-preserving refactor.

Do not introduce an external CLI framework in this issue.

A small internal argument helper is allowed only if it removes real duplication after the vertical split.

Preserve AXI behavior for stdout, stderr, structured errors, exit codes, no-args behavior, contextual help, and `--help`.

## Target shape

```text
src/cli/task/
  taskCli.ts
  support.ts
  dashboard.ts
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

The important shape is that CLI edge code lives under `src/cli/task`, command modules are vertical slices, and Task domain or use-case files do not depend on CLI modules.

## Acceptance criteria

- [ ] `src/task/taskCli.ts` is removed or reduced to a moved compatibility-free implementation under `src/cli/task`.
- [ ] Top-level CLI routing imports the task CLI from `src/cli/task`.
- [ ] Task create, list, show, start, context, and comment commands live in separate vertical command modules.
- [ ] Dashboard or no-args task output is separated from subcommand routing.
- [ ] Shared task CLI loading, Task ID resolution helpers, and common error rendering live in a small support module.
- [ ] `descriptionFile.ts` and `commentFile.ts` move under `src/task/files`.
- [ ] Task CLI modules depend on `TaskUseCases` and do not bypass it for Task behavior.
- [ ] Task domain and use-case modules do not import task CLI modules.
- [ ] Existing task CLI stdout shape remains unchanged.
- [ ] Existing task CLI structured errors and exit codes remain unchanged.
- [ ] Existing task CLI `--help` and no-args behavior remain unchanged.
- [ ] No external CLI framework is introduced.
- [ ] Fallow boundary configuration reflects the new CLI task location if needed.
- [ ] If the Fallow health score allows it, restore the score gate toward the previous `88.7` baseline.
- [ ] If the previous Fallow score gate cannot be restored in this issue, document which remaining hotspots block it.
- [ ] `just quality` passes.

## Blocked by

- `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`
