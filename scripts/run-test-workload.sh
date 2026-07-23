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
option_value=0
for arg in "$@"; do
    if (( option_value == 1 )); then
        option_value=0
        continue
    fi
    case "$arg" in
        --testNamePattern|-t)
            has_selection=1
            option_value=1
            ;;
        --reporter|-r|--pool|--environment|-e|--config|-c|--root|--dir|--project|--maxWorkers|--minWorkers|--retry|--bail|--shard|--coverage.provider|--coverage.reportsDirectory|--coverage.include|--coverage.exclude)
            option_value=1
            ;;
        --)
            has_selection=1
            ;;
        --*=*|-*) ;;
        *)
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
