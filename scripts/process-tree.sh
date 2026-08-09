#!/usr/bin/env bash

process_tree_children() {
    pgrep -P "$1" 2>/dev/null || true
}

process_tree_pid_state() {
    ps -o stat= -p "$1" 2>/dev/null | tr -d ' ' | cut -c1
}

process_tree_wait_for_termination() {
    local pid=$1
    local direct_child=${2:-0}
    local state
    while true; do
        state=$(process_tree_pid_state "$pid")
        if [[ -z "$state" || ( "$direct_child" == "1" && "$state" == "Z" ) ]]; then
            return
        fi
        sleep 0.02
    done
}

process_tree_terminate_pid() {
    local pid=$1
    local signal=$2
    local direct_child=${3:-0}
    local child
    local state

    while read -r child; do
        [[ -n "$child" ]] || continue
        process_tree_terminate_pid "$child" "$signal"
    done < <(process_tree_children "$pid")

    kill -"$signal" "$pid" 2>/dev/null || true
    for _ in {1..50}; do
        state=$(process_tree_pid_state "$pid")
        if [[ -z "$state" || ( "$direct_child" == "1" && "$state" == "Z" ) ]]; then
            return
        fi
        sleep 0.02
    done

    kill -KILL "$pid" 2>/dev/null || true
    process_tree_wait_for_termination "$pid" "$direct_child"
}

process_tree_terminate() {
    local root=$1
    local signal=${2:-TERM}
    process_tree_terminate_pid "$root" "$signal" 1
}
