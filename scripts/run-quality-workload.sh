#!/usr/bin/env bash
set -uo pipefail

if (( $# != 1 )); then
    echo "usage: run-quality-workload.sh <quality|full-quality>" >&2
    exit 2
fi

mode=$1
source "$(dirname "${BASH_SOURCE[0]}")/process-tree.sh"
case "$mode" in
    quality|full-quality) ;;
    *)
        echo "error: unsupported quality workload: $mode" >&2
        exit 2
        ;;
esac

child_pids=()
interrupted_status=0
lock_wait_ms=0
lock_acquired_at_file=$(mktemp "${TMPDIR:-/tmp}/but-why-quality-lock-acquired.XXXXXX")
cleanup_lock_timing() {
    rm -f "$lock_acquired_at_file"
}
trap cleanup_lock_timing EXIT

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
    local test_started_at_ns
    local test_status
    rm -f "$lock_acquired_at_file"
    test_started_at_ns=$(date +%s%N)
    start_child env BY_TEST_SUITE="$suite" BY_CAPACITY_LOCK_ACQUIRED_AT_FILE="$lock_acquired_at_file" just test
    test_pid=${child_pids[-1]}
    wait_for_child "$test_pid"
    test_status=$?
    if [[ -s "$lock_acquired_at_file" ]]; then
        local lock_acquired_at_ns
        lock_acquired_at_ns=$(<"$lock_acquired_at_file")
        if (( lock_acquired_at_ns > test_started_at_ns )); then
            lock_wait_ms=$((lock_wait_ms + (lock_acquired_at_ns - test_started_at_ns) / 1000000))
        fi
    fi
    return "$test_status"
}

started_at_ns=$(date +%s%N)
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
echo "$mode completed in ${elapsed}s"
if [[ "$mode" == "quality" && $elapsed_ms -gt 10000 ]]; then
    echo "warning: quality exceeded its 10s operating budget"
elif [[ "$mode" == "full-quality" && $elapsed_ms -gt 30000 ]]; then
    echo "warning: full-quality exceeded its 30s operating budget"
fi
exit "$exit_status"
