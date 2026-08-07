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
        echo "help: enter the repository through direnv or run nix develop"
        exit 1
    fi
    if [[ "$(pnpm --version)" != "10.28.0" ]]; then
        echo "error: pnpm 10.28.0 is required"
        echo "help: enter the repository through direnv or run nix develop"
        exit 1
    fi
    pnpm install --frozen-lockfile

# Check Just formatting plus Biome formatting, lint rules, and the organizeImports assist without modifying files.
check:
    @just --unstable --fmt --check
    @pnpm exec biome check .

# Apply Just formatting plus Biome formatting, safe lint fixes, and the organizeImports assist.
fix:
    @just --unstable --fmt
    @pnpm exec biome check --write .

# Run routine product feedback without coverage or slow external boundaries.
quality:
    @exec ./scripts/run-quality-workload.sh quality

# Run complete product feedback, including focused external boundaries, without coverage.
full-quality:
    @exec ./scripts/run-quality-workload.sh full-quality

# Run routine static checks that do not require coverage.
_quality-static-routine:
    #!/usr/bin/env bash
    set -uo pipefail
    just docs-check & docs_pid=$!
    just check & check_pid=$!
    just ast-grep-check & ast_grep_pid=$!
    just typecheck & typecheck_pid=$!
    just _fallow-routine-check & fallow_pid=$!
    status=0
    for pid in "$docs_pid" "$check_pid" "$ast_grep_pid" "$typecheck_pid" "$fallow_pid"; do
        wait "$pid" || status=1
    done
    exit "$status"

# Validate links and anchors in tracked and non-ignored untracked Markdown files.
docs-check:
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -d '' candidate_markdown_files < <(git ls-files -z --cached --others --exclude-standard -- '*.md')
    markdown_files=()
    for file in "${candidate_markdown_files[@]}"; do
        [[ -f "$file" ]] && markdown_files+=("$file")
    done
    pnpm --silent run docs-check -- "${markdown_files[@]}"

# Check structural code rules.
ast-grep-check:
    @pnpm run ast-grep-check

# Check dead code, dependencies, and named architecture seams.
fallow-check:
    just coverage
    just _fallow-check

_fallow-check:
    just _fallow-routine-check
    just _fallow-coverage-check

_fallow-routine-check:
    #!/usr/bin/env bash
    set -uo pipefail
    status=0
    pnpm exec fallow dead-code --no-production --no-cache --fail-on-issues || status=1
    exit "$status"

_fallow-coverage-check:
    pnpm exec fallow health --no-production --no-cache --coverage coverage/coverage-final.json --report-only

# Report advisory code-health and duplication findings.
health:
    just coverage
    pnpm exec fallow health --no-production --no-cache --coverage coverage/coverage-final.json --report-only
    pnpm exec fallow dupes --no-production --no-cache

# Lint the codebase.
lint:
    pnpm run lint

# Type-check the codebase.
typecheck:
    @pnpm run typecheck

# Run tests, forwarding any arguments.
test *args:
    @./scripts/run-test-workload.sh test "$@"

# Run tests with measured production coverage.
coverage *args:
    @./scripts/run-test-workload.sh coverage "$@"

# Build the production package.
build:
    @rm -rf dist
    @pnpm --silent run build

# Create the npm package tarball.
pack:
    pnpm pack

# Run comparative cold-start measurements for the production and package executables.
cli-loading-benchmark:
    @node scripts/cli-loading-benchmark.mjs

# Format the codebase.
format:
    pnpm run format

# Check code and Just formatting.
format-check:
    just --unstable --fmt --check
    pnpm run format-check

# Run the local by CLI, forwarding any arguments.
[no-exit-message]
by *args:
    @./bin/by "$@"
