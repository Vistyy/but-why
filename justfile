set positional-arguments := true

# List available commands.
default:
    @just --list

# Initialize dependencies in the locked project environment.
init:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]]; then
        echo "error: Node.js 24 is required"
        echo "help: install Node.js 24 and pnpm 11.21.0"
        exit 1
    fi
    if [[ "$(pnpm --version)" != "11.21.0" ]]; then
        echo "error: pnpm 11.21.0 is required"
        echo "help: install Node.js 24 and pnpm 11.21.0"
        exit 1
    fi
    pnpm install --frozen-lockfile

# Run focused source-style checks without modifying files.
check:
    @just --unstable --fmt --check
    @pnpm exec biome check .

# Apply Just formatting plus Biome formatting, safe lint fixes, and the organizeImports assist.
fix:
    @just --unstable --fmt
    @pnpm exec biome check --write .

# Run the only required repository-wide check workflow.
quality:
    @exec ./scripts/run-quality-workload.sh

# Run blocking static checks that do not require coverage.
_quality-static:
    #!/usr/bin/env bash
    set -uo pipefail
    just docs-check & docs_pid=$!
    just check & check_pid=$!
    just ast-grep-check & ast_grep_pid=$!
    just typecheck & typecheck_pid=$!
    just _fallow-static-check & fallow_pid=$!
    status=0
    for pid in "$docs_pid" "$check_pid" "$ast_grep_pid" "$typecheck_pid" "$fallow_pid"; do
        wait "$pid" || status=1
    done
    exit "$status"

# Run focused link and anchor checks for repository Markdown files.
docs-check:
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -d '' candidate_markdown_files < <(git ls-files -z --cached --others --exclude-standard -- '*.md')
    markdown_files=()
    for file in "${candidate_markdown_files[@]}"; do
        [[ -f "$file" ]] && markdown_files+=("$file")
    done
    pnpm --silent run docs-check -- "${markdown_files[@]}"

# Run focused structural TypeScript contract checks.
ast-grep-check:
    @pnpm run ast-grep-check

# Run focused Fallow dead-code, dependency, and architecture checks.
fallow-check:
    just _fallow-static-check

_fallow-static-check:
    #!/usr/bin/env bash
    set -uo pipefail
    status=0
    pnpm exec fallow dead-code --no-production --no-cache --fail-on-issues || status=1
    exit "$status"

# Run optional advisory code-health analysis.
health:
    node scripts/run-health-report.mjs

# Run focused Biome lint diagnostics.
lint:
    pnpm run lint

# Run focused TypeScript and Effect diagnostics.
typecheck:
    @pnpm run typecheck

# Run selected tests, or all maintained tests when no selection is given.
test *args:
    @./scripts/run-test-workload.sh test "$@"

# Run selected tests with coverage, or all maintained tests when no selection is given.
coverage *args:
    @./scripts/run-test-workload.sh coverage "$@"

# Build the production package.
build:
    @rm -rf dist
    @pnpm --silent run build

# Create the npm package tarball.
pack:
    pnpm pack

# Format the codebase.
format:
    pnpm run format

# Run focused code and Just formatting checks.
format-check:
    just --unstable --fmt --check
    pnpm run format-check
