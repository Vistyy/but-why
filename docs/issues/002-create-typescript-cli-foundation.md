# Create the TypeScript CLI foundation

## Parent

`docs/prd.md`

## What to build

Create the project foundation for the `by` CLI.

The CLI should be runnable, use the chosen TypeScript quality stack, and establish agent-first output conventions before product behavior is added.

## Resolved decisions

### Bare `by` before initialization

Running `by` in a workspace that has not been initialized succeeds with exit code `0`.
It prints the AXI home view to stdout as TOON.
It does not print generic help.

Expected exact field set:

```toon
bin: ~/.local/bin/by
description: Manage But Why? tasks in this workspace
initialized: false
tasks: 0 tasks found because this workspace is not initialized
help[1]:
  Run `by init` to create repo-local But Why? state
```

Issue 002 must not add counts, version, config details, or extra next-action fields to this pre-init home view.

The `bin` value must be the current executable path with the user's home directory collapsed to `~`.

### Output boundary

Internal logic should use typed JSON-like objects.
The CLI should convert those objects to TOON only at the stdout boundary.
Domain and application logic must not build behavior around TOON strings.

Prefer `@toon-format/toon` for TOON serialization.
A hand-rolled serializer is allowed only as an isolated fallback if the package blocks implementation.
The home view and structured error shapes must be locked by exact output tests.

### Structured errors

CLI errors go to stdout as TOON.
Diagnostics, progress, and debug logs go to stderr.
Raw dependency errors, stack traces, and interactive prompts must not leak to users.

Exit codes:

- `0` means success, including idempotent no-ops.
- `1` means runtime error.
- `2` means usage error.

Baseline usage error shape:

```toon
error:
  code: missing_required_flag
  message: --title is required
help[1]:
  Run `by task create --title "<title>"`
```

Unknown commands or flags are usage errors with exit code `2`.
They must print a structured error to stdout and must not dump generic help.

Example:

```toon
error:
  code: unknown_command
  message: Unknown command: frobnicate
help[1]:
  Run `by --help`
```

The `help` command must be the specific command that fixes the error.

Runtime errors use exit code `1`.
They must print structured TOON to stdout and must not print stack traces to users.
Since issue 002 has minimal runtime behavior, this may be covered by an internal error mapping test instead of an end-to-end command.

Baseline runtime error shape:

```toon
error:
  code: internal_error
  message: The command failed unexpectedly
help[1]:
  Report this failure with the command and workspace path
```

### Tooling choices

Issue 002 uses the chosen repo toolchain:

- Nix provides the project Node.js, pnpm, and Just tools.
- Node.js is `nodejs_24` from the repo flake.
- pnpm is the Nix pnpm package overridden to use that same Node.js package.
- Corepack is not part of the repo toolchain.
- Agents use Just recipes instead of invoking pnpm directly.
- The module system is ESM.
- The test runner is Vitest.
- Biome handles linting and formatting.
- TypeScript compiler typechecks with `tsc --noEmit`.
- SQLite access uses `node:sqlite`.
- Issue 002 should use a tiny explicit argv router instead of a CLI parser unless a concrete need appears.
- `just quality` wires formatting checks, linting, typechecking, and tests.
- All choices must support strict TypeScript, Effect, Effect Schema, SQLite access, and AXI output.
- CLI behavior must remain non-interactive.

### Stable quality recipes

The repo must provide stable agent-facing Just recipes regardless of the underlying tooling or technology stack.

Required recipes:

```sh
just quality       # format-check + lint + typecheck + test
just lint
just typecheck
just test
just format
just format-check
```

Agents should call these recipes instead of invoking package-manager-specific tooling directly.

`just format` may modify files.
`just format-check` must not modify files.
`just quality` must run `format-check`, linting, typechecking, and tests, and must not modify files.

### Command surface

Issue 002 implements only:

```sh
by
by --help
```

It must not implement aliases, `by init`, task subcommands, or hidden product behavior.
The home view may suggest `by init`, even though issue 003 implements that command.

### Help behavior

`by --help` must print a concise command reference.
It must document only the command surface that exists in issue 002.
It must not replace the no-args home view.
Bare `by` remains live content, not help.

### SQLite scope

Issue 002 only proves SQLite access at the foundation level.

It must:

- use `node:sqlite`;
- prove the CLI foundation can open and query an in-memory SQLite database in tests.

It must not:

- create `.but-why/state.sqlite`;
- add migrations;
- create repo-local But Why? state;
- implement `by init` behavior.

Persisted repo-local state belongs to issue 003.

## Acceptance criteria

- [ ] The `by` executable can run from the repo.
- [ ] Running `by` prints a structured empty dashboard instead of generic help.
- [ ] Structured output goes to stdout.
- [ ] Progress and diagnostics go to stderr.
- [ ] The project uses strict TypeScript, Effect, Effect Schema, SQLite access, linting, typechecking, and tests.
- [ ] `just quality` verifies formatting, linting, typechecking, and tests without modifying files.
- [ ] The repo provides stable agent-facing Just recipes for quality tasks regardless of underlying tooling.
- [ ] CLI errors are structured and actionable.
- [ ] `by --help` prints a concise command reference for the current command surface.

## Blocked by

- 001-prove-sandcastle-v1-execution.md
