#!/usr/bin/env bash

process_tree_boundary_is_active() {
    local root=$1
    local state
    state=$(ps -o stat= -p "$root" 2>/dev/null | tr -d ' ' | cut -c1)
    [[ -n "$state" && "$state" != "Z" ]]
}

process_tree_wait_for_boundary() {
    local root=$1
    for _ in {1..150}; do
        if ! process_tree_boundary_is_active "$root"; then
            return 0
        fi
        sleep 0.02
    done
    return 1
}

process_tree_signal_boundary() {
    local root=$1
    local signal=$2
    kill -"$signal" -- "-$root" 2>/dev/null || true
    kill -"$signal" "$root" 2>/dev/null || true
}

process_tree_terminate() {
    local root=$1
    local signal=${2:-TERM}

    process_tree_signal_boundary "$root" "$signal"
    if process_tree_wait_for_boundary "$root"; then
        process_tree_signal_boundary "$root" KILL
        return
    fi

    process_tree_signal_boundary "$root" KILL
    process_tree_wait_for_boundary "$root" || true
}
