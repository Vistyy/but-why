#!/usr/bin/env bash
set -uo pipefail

if (( $# != 0 )); then
    echo "error: the quality runner does not accept arguments; run just quality" >&2
    exit 2
fi

source "$(dirname "${BASH_SOURCE[0]}")/process-tree.sh"
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ "${BY_CAPACITY_LOCK_HELD:-0}" != "1" ]]; then
    started_at_ns=$(date +%s%N)
    lock_acquired_at_file=$(mktemp "${TMPDIR:-/tmp}/but-why-quality-lock-acquired.XXXXXX")
    export BY_QUALITY_STARTED_AT_NS="$started_at_ns"
    export BY_CAPACITY_LOCK_ACQUIRED_AT_FILE="$lock_acquired_at_file"
    exec "$script_directory/with-capacity-lock.sh" quality "$script_directory/run-quality-workload.sh"
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
    setsid env --default-signal=INT,TERM "$@" &
    child_pids+=("$!")
}

terminate_children() {
    interrupted_status=$1
    local signal=$2
    terminator_pids=()
    for pid in "${child_pids[@]}"; do
        process_tree_terminate "$pid" "$signal" &
        terminator_pids+=("$!")
    done
    for pid in "${terminator_pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}
trap 'terminate_children 130 INT' INT
trap 'terminate_children 143 TERM' TERM

wait_for_child() {
    local pid=$1
    wait "$pid"
    local status=$?
    if (( interrupted_status == 0 )); then
        case "$status" in
            130|143) interrupted_status=$status ;;
        esac
    fi
    if (( interrupted_status != 0 )); then
        return "$interrupted_status"
    fi
    return "$status"
}

status=0
start_child just _quality-static
static_pid=${child_pids[-1]}
start_child just build
build_pid=${child_pids[-1]}
wait_for_child "$build_pid" || status=1
wait_for_child "$static_pid" || status=1
if (( interrupted_status == 0 )); then
    start_child just test
    test_pid=${child_pids[-1]}
    wait_for_child "$test_pid" || status=1
fi
if (( interrupted_status == 0 && status == 0 )) && [[ "${BY_RELEASE_BASELINE_REHEARSAL:-0}" == "1" ]]; then
    required_rehearsal_environment=(
        BY_RELEASE_BASELINE_OLD_STATE
        BY_RELEASE_BASELINE_OLD_RUNTIME
        BY_RELEASE_BASELINE_CANDIDATE_COMMIT
        BY_RELEASE_BASELINE_OLD_SOURCE_COMMIT
        BY_RELEASE_BASELINE_OLD_MANIFEST_SHA256
        BY_RELEASE_BASELINE_CURRENT_RUNTIME_SHA256
    )
    for variable in "${required_rehearsal_environment[@]}"; do
        if [[ -z "${!variable:-}" ]]; then
            echo "error: ${variable} is required for the release-baseline rehearsal" >&2
            status=1
        fi
    done
    if (( status == 0 )); then
        start_child just rehearse-release-baseline-cutover \
            --fixture-repository . \
            --old-state "$BY_RELEASE_BASELINE_OLD_STATE" \
            --old-runtime "$BY_RELEASE_BASELINE_OLD_RUNTIME" \
            --expected-candidate-commit "$BY_RELEASE_BASELINE_CANDIDATE_COMMIT" \
            --expected-old-source-commit "$BY_RELEASE_BASELINE_OLD_SOURCE_COMMIT" \
            --expected-old-manifest-sha256 "$BY_RELEASE_BASELINE_OLD_MANIFEST_SHA256" \
            --expected-current-runtime-sha256 "$BY_RELEASE_BASELINE_CURRENT_RUNTIME_SHA256"
        rehearsal_pid=${child_pids[-1]}
        wait_for_child "$rehearsal_pid" || status=1
    fi
fi

trap - INT TERM
if (( interrupted_status == 0 )) && [[ -s "${BY_CAPACITY_INTERRUPTION_FILE:-}" ]]; then
    interruption_status=$(<"$BY_CAPACITY_INTERRUPTION_FILE")
    case "$interruption_status" in
        130|143) interrupted_status=$interruption_status ;;
    esac
fi
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
    echo "quality interrupted after ${elapsed}s; rerun just quality to retry" >&2
elif (( exit_status != 0 )); then
    echo "quality failed after ${elapsed}s" >&2
else
    echo "quality completed in ${elapsed}s"
fi
exit "$exit_status"
