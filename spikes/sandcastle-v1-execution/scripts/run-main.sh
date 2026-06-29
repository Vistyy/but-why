#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

bash "$SCRIPT_DIR/prepare-sandcastle-main.sh"
pnpm --dir "$SPIKE_DIR" install --frozen-lockfile=false
pnpm --dir "$SPIKE_DIR" exec tsc --noEmit
pnpm --dir "$SPIKE_DIR" exec tsx src/prototype.ts --all
