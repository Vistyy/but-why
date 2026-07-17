set positional-arguments

# List available commands.
default:
    @just --list

# Run all quality checks.
quality:
    #!/usr/bin/env bash
    set -uo pipefail
    just quality-static & static_pid=$!
    just test & test_pid=$!
    status=0
    wait "$static_pid" || status=1
    wait "$test_pid" || status=1
    exit "$status"

# Run independent static checks in parallel.
quality-static:
    #!/usr/bin/env bash
    set -uo pipefail
    just format-check & format_pid=$!
    just lint & lint_pid=$!
    just ast-grep-check & ast_grep_pid=$!
    just typecheck & typecheck_pid=$!
    just fallow-check & fallow_pid=$!
    status=0
    for pid in "$format_pid" "$lint_pid" "$ast_grep_pid" "$typecheck_pid" "$fallow_pid"; do
        wait "$pid" || status=1
    done
    exit "$status"

# Check structural code rules.
ast-grep-check:
    pnpm run ast-grep-check

# Check dead code, duplication, complexity, and health.
fallow-check:
    pnpm exec fallow dead-code --no-production --no-cache --fail-on-issues
    pnpm exec fallow dupes --no-production --no-cache --fail-on-issues
    pnpm exec fallow health --no-production --no-cache --complexity --min-severity moderate
    # Fallow score gates are CLI-only. Keep the floor at the current exact full health score.
    # This preserves the health gate while allowing the explicit architecture seams added for boundary enforcement.
    pnpm exec fallow health --no-production --no-cache --min-score 87.5 --score

# Lint the codebase.
lint:
    pnpm run lint

# Type-check the codebase.
typecheck:
    pnpm run typecheck

# Run tests, forwarding any arguments.
test *args:
    pnpm exec vitest run "$@"

# Create the npm package tarball.
pack:
    npm pack

# Format the codebase.
format:
    pnpm run format

# Check code formatting.
format-check:
    pnpm run format-check

# Run the local by CLI, forwarding any arguments.
[no-exit-message]
by *args:
    @./bin/by "$@"
