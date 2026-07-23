#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 )); then
    echo "usage: with-capacity-lock.sh <workload-class> <command> [args...]" >&2
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

exec 9>"$lock_file"
if ! flock -n 9; then
    active_workload=$(cat "$status_file" 2>/dev/null || printf 'unknown')
    printf 'error: another complete workload is already running (active workload: %s)\n' "$active_workload" >&2
    printf 'help: wait for the active workload to finish before running %s\n' "$workload_class" >&2
    exit 1
fi

printf '%s\n' "$workload_class" > "$status_file"
cleanup() {
    rm -f "$status_file"
}
trap cleanup EXIT

export BY_CAPACITY_LOCK_HELD=1
set +e
"$@" &
child_pid=$!
trap 'kill -TERM "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; exit 143' INT TERM
wait "$child_pid"
status=$?
trap - INT TERM
set -e
exit "$status"
