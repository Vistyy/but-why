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

# Run all quality checks.
quality:
    just coverage
    just quality-static
    just build

# Run independent static checks in parallel.
quality-static:
    #!/usr/bin/env bash
    set -uo pipefail
    just config-check & config_pid=$!
    just docs-check & docs_pid=$!
    just format-check & format_pid=$!
    just lint & lint_pid=$!
    just ast-grep-check & ast_grep_pid=$!
    just typecheck & typecheck_pid=$!
    just fallow-check & fallow_pid=$!
    status=0
    for pid in "$config_pid" "$docs_pid" "$format_pid" "$lint_pid" "$ast_grep_pid" "$typecheck_pid" "$fallow_pid"; do
        wait "$pid" || status=1
    done
    exit "$status"

# Validate maintained quality configuration.
config-check:
    just --unstable --fmt --check
    pnpm exec biome check .but-why/config.json .fallowrc.jsonc biome.json fallow-rules/architecture.json package.json tsconfig.json tsconfig.build.json vitest.config.ts
    @pnpm exec fallow list --entry-points --boundaries --no-cache > /dev/null 2>&1 || { echo "error: Fallow configuration is invalid"; echo "help: pnpm exec fallow list --entry-points --boundaries --no-cache"; exit 1; }

# Validate links and anchors in every tracked Markdown file.
docs-check:
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -d '' markdown_files < <(git ls-files -z -- '*.md')
    pnpm --silent run docs-check -- "${markdown_files[@]}"

# Check structural code rules.
ast-grep-check:
    pnpm run ast-grep-check

# Check dead code, named architecture seams, dependencies, and health; report duplication.
fallow-check:
    #!/usr/bin/env bash
    set -uo pipefail
    status=0
    pnpm exec fallow dead-code --no-production --no-cache --fail-on-issues || status=1
    pnpm exec fallow dupes --no-production --no-cache || status=1
    pnpm exec fallow health --no-production --no-cache --coverage coverage/coverage-final.json --complexity --min-severity moderate || status=1
    exit "$status"

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

# Check code formatting.
format-check:
    pnpm run format-check

# Run the local by CLI, forwarding any arguments.
[no-exit-message]
by *args:
    @./bin/by "$@"
