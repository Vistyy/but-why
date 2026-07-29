#!/usr/bin/env bash
set -uo pipefail

if (( $# != 1 )); then
    echo "error: a quality workload is required; use run-quality-workload.sh <quality|full-quality>" >&2
    exit 2
fi

mode=$1
source "$(dirname "${BASH_SOURCE[0]}")/process-tree.sh"
case "$mode" in
    quality|full-quality) ;;
    *)
        echo "error: unsupported quality workload: $mode; use run-quality-workload.sh quality or run-quality-workload.sh full-quality" >&2
        exit 2
        ;;
esac

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ "${BY_CAPACITY_LOCK_HELD:-0}" != "1" ]]; then
    started_at_ns=$(date +%s%N)
    lock_acquired_at_file=$(mktemp "${TMPDIR:-/tmp}/but-why-quality-lock-acquired.XXXXXX")
    export BY_QUALITY_STARTED_AT_NS="$started_at_ns"
    export BY_CAPACITY_LOCK_ACQUIRED_AT_FILE="$lock_acquired_at_file"
    exec "$script_directory/with-capacity-lock.sh" "complete $mode" "$script_directory/run-quality-workload.sh" "$mode"
fi

child_pids=()
interrupted_status=0
lock_wait_ms=0
started_at_ns=${BY_QUALITY_STARTED_AT_NS:-$(date +%s%N)}
if [[ -s "${BY_CAPACITY_LOCK_ACQUIRED_AT_FILE:-}" ]]; then
    lock_acquired_at_ns=$(<"$BY_CAPACITY_LOCK_ACQUIRED_AT_FILE")
    if (( lock_acquired_at_ns > started_at_ns )); then
        lock_wait_ms=$(( (lock_acquired_at_ns - started_at_ns) / 1000000 ))
    fi
fi

start_child() {
    setsid --wait "$@" &
    child_pids+=("$!")
}

terminate_children() {
    interrupted_status=$1
    terminator_pids=()
    for pid in "${child_pids[@]}"; do
        process_tree_terminate "$pid" &
        terminator_pids+=("$!")
    done
    for pid in "${terminator_pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}
trap 'terminate_children 130' INT
trap 'terminate_children 143' TERM

wait_for_child() {
    local pid=$1
    wait "$pid"
    local status=$?
    if (( interrupted_status != 0 )); then
        return "$interrupted_status"
    fi
    return "$status"
}

run_test_child() {
    local suite=$1
    local test_status
    start_child env BY_TEST_SUITE="$suite" just test
    test_pid=${child_pids[-1]}
    wait_for_child "$test_pid"
    test_status=$?
    return "$test_status"
}

status=0
start_child just _quality-static-routine
static_pid=${child_pids[-1]}
if [[ "$mode" == "quality" ]]; then
    start_child just build
    build_pid=${child_pids[-1]}
    wait_for_child "$build_pid" || status=1
    if (( status == 0 && interrupted_status == 0 )); then
        run_test_child routine || status=1
    fi
    wait_for_child "$static_pid" || status=1
else
    start_child just build
    build_pid=${child_pids[-1]}
    wait_for_child "$build_pid" || status=1
    wait_for_child "$static_pid" || status=1
    if (( status == 0 && interrupted_status == 0 )); then
        run_test_child "" || status=1
    fi
fi

trap - INT TERM
if (( interrupted_status != 0 )); then
    for pid in "${child_pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
    exit_status=$interrupted_status
else
    exit_status=$status
fi

elapsed_ms=$((($(date +%s%N) - started_at_ns) / 1000000 - lock_wait_ms))
if (( elapsed_ms < 0 )); then
    elapsed_ms=0
fi
printf -v elapsed '%d.%03d' "$((elapsed_ms / 1000))" "$((elapsed_ms % 1000))"
if (( interrupted_status != 0 )); then
    echo "$mode interrupted after ${elapsed}s; rerun just $mode to retry" >&2
else
    echo "$mode completed in ${elapsed}s"
    if [[ "$mode" == "quality" && $elapsed_ms -gt 10000 ]]; then
        echo "warning: quality exceeded its 10s operating budget"
    elif [[ "$mode" == "full-quality" && $elapsed_ms -gt 30000 ]]; then
        echo "warning: full-quality exceeded its 30s operating budget"
    fi
fi
exit "$exit_status"
