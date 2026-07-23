#!/usr/bin/env bash
set -euo pipefail

if (( $# < 1 )); then
    echo "usage: run-test-workload.sh <test|coverage> [vitest args...]" >&2
    exit 2
fi

workload=$1
shift
case "$workload" in
    test|coverage) ;;
    *)
        echo "error: unsupported test workload: $workload" >&2
        exit 2
        ;;
esac

has_selection=0
for arg in "$@"; do
    case "$arg" in
        --testNamePattern|-t|--related|--changed|--findRelatedTests|--testNamePattern=*|-t=*)
            has_selection=1
            ;;
        test/*|src/*|*.test.*|*.spec.*)
            has_selection=1
            ;;
    esac
done

vitest_args=(run)
if [[ "$workload" == "coverage" ]]; then
    vitest_args+=(--coverage)
fi
vitest_args+=("$@")

if (( has_selection == 1 )); then
    exec pnpm exec vitest "${vitest_args[@]}"
fi

exec ./scripts/with-capacity-lock.sh "complete $workload" pnpm exec vitest "${vitest_args[@]}"
