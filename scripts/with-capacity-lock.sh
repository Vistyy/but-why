#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 )); then
    echo "error: workload class and command are required; use with-capacity-lock.sh <workload-class> <command> [args...]" >&2
    exit 2
fi

workload_class=$1
shift

if [[ "${BY_CAPACITY_LOCK_HELD:-0}" == "1" ]]; then
    exec "$@"
fi

git_common_directory=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
lock_file=${BY_CAPACITY_LOCK_FILE:-${git_common_directory:-${TMPDIR:-/tmp}}/but-why-quality.lock}
status_file="${lock_file}.status"
mkdir -p "$(dirname "$lock_file")"
source "$(dirname "${BASH_SOURCE[0]}")/process-tree.sh"

child_pid=
interrupted_status=0
interruption_file=$(mktemp "${TMPDIR:-/tmp}/but-why-workload-interrupted.XXXXXX")
export BY_CAPACITY_INTERRUPTION_FILE=$interruption_file
terminate_child() {
    interrupted_status=$1
    local signal=$2
    printf '%s\n' "$interrupted_status" > "$interruption_file"
    if [[ -z "$child_pid" ]]; then
        return
    fi

    process_tree_terminate "$child_pid" "$signal"
}

report_interruption() {
    echo "interrupted: $workload_class; rerun the same command to retry" >&2
}

handle_interruption() {
    local status=$1
    local signal=$2
    trap '' INT TERM
    if (( interrupted_status != 0 )); then
        return
    fi
    terminate_child "$status" "$signal"
    report_interruption
}

trap 'handle_interruption 130 INT' INT
trap 'handle_interruption 143 TERM' TERM

lock_owned=0
cleanup() {
    rm -f "$interruption_file"
    if (( lock_owned == 1 )); then
        rm -f "$status_file"
    fi
    if [[ -n "${BY_CAPACITY_LOCK_ACQUIRED_AT_FILE:-}" ]]; then
        rm -f "$BY_CAPACITY_LOCK_ACQUIRED_AT_FILE"
    fi
}
trap cleanup EXIT

exec 9>"$lock_file"
waiting=0
while ! flock -n 9; do
    if (( interrupted_status != 0 )); then
        exit "$interrupted_status"
    fi
    if (( waiting == 0 )); then
        active_workload=$(cat "$status_file" 2>/dev/null || printf 'unknown')
        printf 'waiting: %s is waiting for capacity (active workload: %s)\n' "$workload_class" "$active_workload" >&2
        waiting=1
    fi
    sleep 0.1 || true
done

lock_owned=1
if (( interrupted_status != 0 )); then
    exit "$interrupted_status"
fi

printf '%s\n' "$workload_class" > "$status_file"
if [[ -n "${BY_CAPACITY_LOCK_ACQUIRED_AT_FILE:-}" ]]; then
    date +%s%N > "$BY_CAPACITY_LOCK_ACQUIRED_AT_FILE" 2>/dev/null || true
fi

export BY_CAPACITY_LOCK_HELD=1

set +e
setsid env --default-signal=INT,TERM "$@" 9>&- &
child_pid=$!
wait "$child_pid"
status=$?
set -e

if (( interrupted_status != 0 )); then
    wait "$child_pid" 2>/dev/null || true
    exit "$interrupted_status"
fi

exit "$status"
