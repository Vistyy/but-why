# CLI startup import optimization

Status: proposed for operator review.

Removal condition: Remove this plan after accepted requirements are recorded in the applicable Task and any qualifying ADR, then implementation and verification evidence are retained by their normal authorities.

## Goal

Reduce the published `by` executable startup time without changing its command syntax, generated help, stdout, stderr, exit codes, Trusted But Why Executable selection, or Effect resource lifecycle.

This plan excludes the source-checkout `tsx` loader cost because publication removes that cost.

## Evidence

The baseline used fresh Node 24.18.0 processes against the compiled executable with output redirected.

The compiled current executable had a median startup time of 714 ms for `--help` and 760 ms for `task list` in the final controlled spike.

The source imports the root `effect` barrel throughout `src/` and the root `@effect/platform-node` barrel in `src/cliCommandTree.ts` and `src/command/hostCommand.ts`.

The installed packages document direct ESM subpaths for every currently imported Effect and platform namespace.

A disposable build that changed every `src/` root Effect import to its direct namespace subpath and changed the two platform-node imports to direct subpaths passed TypeScript compilation.

That build preserved byte-identical stdout and stderr plus identical exit codes for `--help`, `task list`, no arguments, `--output json --version`, and an invalid command.

The disposable build had medians of 494 ms for `--help` and 595 ms for `task list`, which are improvements of 31% and 22% respectively in the same spike.

The `effect` root import took approximately 213-295 ms in isolated fresh-process measurements, while the required direct Effect subpaths took approximately 110-142 ms.

The `@effect/platform-node` root import took approximately 486-590 ms, while the three required direct platform subpaths took approximately 198-220 ms.

## Proposed implementation

1. Replace each `src/` import from `effect` with direct documented namespace imports such as `import * as Effect from "effect/Effect"` and `import * as Schema from "effect/Schema"`.

2. Replace the root platform imports with `@effect/platform-node/NodeFileSystem`, `@effect/platform-node/NodePath`, `@effect/platform-node/NodeTerminal`, and `@effect/platform-node/NodeCommandExecutor` namespace imports.

3. Preserve the existing symbols and call sites by using namespace imports, so the change affects only module resolution rather than Effect composition, error handling, layers, or resource ownership.

4. Add an `ast-grep` production-source rule that rejects root imports from `effect` and `@effect/platform-node`.

5. Add rule fixtures that prove the rule rejects the two root forms and permits the direct subpaths.

The rule applies only to `src/**/*.ts`.

Tests may retain root imports because they are not part of the shipped command startup path.

## Explicit non-goal

Do not implement lazy command-handler imports in this change.

Effect CLI can preserve generated help with a concrete static descriptor tree and a handler that uses `Effect.tryPromise` around native `import()`.

However, the spike showed that direct package subpaths are the currently proven larger and lower-risk improvement.

Lazy handlers would add asynchronous module-load failure handling, move work into selected commands, and require a separate benchmark that shows a material residual benefit after this import change.

## Verification contract

1. Build the generated output with `just build`.

2. Run `just typecheck`, `just lint`, `just ast-grep-check`, focused CLI tests, and the repository blocking gate `just quality`.

3. Run the compiled executable in fresh processes for `--help`, no arguments, `task list`, `--output json --version`, and an invalid command.

4. Compare each result with the pre-change executable for exact stdout, exact stderr, and exit code.

5. Record raw timings and the median from at least 13 fresh compiled-process runs for `--help` and `task list` on the same machine with the same repository state.

6. Accept the performance result only when both medians improve by at least 15% from the pre-change baseline.

7. Confirm that `by --help` still includes every command and that each command continues to load through the supported CLI interface during the full-quality suite.

## Deferred decision gate

Profile the compiled executable again after the direct-subpath change.

Consider lazy command-handler imports only if a fresh-process workload still exceeds the accepted startup budget and an import trace attributes a material share to handlers that the selected command does not need.

Any lazy-handler proposal must keep names, descriptions, argument and option declarations, completions, and generated help eager.

It must defer only implementation imports and map a dynamic-import failure through the existing runtime-error boundary.

## Resolved decisions

Use documented direct ESM subpaths for current Effect and platform imports.

Do not change `Command.run`, the runtime layer, CLI result capture, serialization, main-checkout resolution, or signal behavior.

Do not replace Effect CLI or use `NodeRuntime.runMain` for this performance work because neither is required by the proven import-resolution change.
