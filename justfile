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

# Run routine product feedback without coverage or slow external boundaries.
quality:
    #!/usr/bin/env bash
    set -uo pipefail
    started_at=$SECONDS
    just _quality-static-routine & static_pid=$!
    just build & build_pid=$!
    status=0
    wait "$build_pid" || status=1
    if (( status == 0 )); then
        BY_TEST_SUITE=routine just test || status=1
    fi
    wait "$static_pid" || status=1
    elapsed=$((SECONDS - started_at))
    echo "quality completed in ${elapsed}s"
    if (( elapsed > 10 )); then
        echo "warning: quality exceeded its 10s operating budget"
    fi
    exit "$status"

# Run complete product feedback, including focused external boundaries, without coverage.
full-quality:
    #!/usr/bin/env bash
    set -uo pipefail
    started_at=$SECONDS
    just build & build_pid=$!
    just _quality-static-routine & static_pid=$!
    status=0
    wait "$build_pid" || status=1
    wait "$static_pid" || status=1
    if (( status == 0 )); then
        just test || status=1
    fi
    elapsed=$((SECONDS - started_at))
    echo "full-quality completed in ${elapsed}s"
    if (( elapsed > 30 )); then
        echo "warning: full-quality exceeded its 30s operating budget"
    fi
    exit "$status"

# Run routine static checks that do not require coverage.
_quality-static-routine:
    #!/usr/bin/env bash
    set -uo pipefail
    just docs-check & docs_pid=$!
    just _biome-check & biome_pid=$!
    just ast-grep-check & ast_grep_pid=$!
    just typecheck & typecheck_pid=$!
    just _fallow-routine-check & fallow_pid=$!
    status=0
    for pid in "$docs_pid" "$biome_pid" "$ast_grep_pid" "$typecheck_pid" "$fallow_pid"; do
        wait "$pid" || status=1
    done
    exit "$status"

# Check Just formatting plus Biome formatting and lint rules in one source scan.
_biome-check:
    just --unstable --fmt --check
    pnpm exec biome check --assist-enabled=false .

# Validate links and anchors in every tracked Markdown file.
docs-check:
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -d '' markdown_files < <(git ls-files -z -- '*.md')
    pnpm --silent run docs-check -- "${markdown_files[@]}"

# Check structural code rules.
ast-grep-check:
    pnpm run ast-grep-check

# Check dead code, dependencies, named architecture seams, and direct health limits.
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
    pnpm run typecheck

# Run tests, forwarding any arguments.
test *args:
    pnpm exec vitest run "$@"

# Run tests with measured production coverage.
coverage *args:
    pnpm exec vitest run --coverage "$@"

# Build the production package.
build:
    @pnpm --silent run build

# Create the npm package tarball.
pack:
    pnpm pack

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
