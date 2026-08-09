#!/usr/bin/env bash

process_tree_descendants() {
    local parent=$1
    local child
    while read -r child; do
        [[ -n "$child" ]] || continue
        process_tree_descendants "$child"
        printf '%s\n' "$child"
    done < <(pgrep -P "$parent" 2>/dev/null || true)
}

process_tree_snapshot() {
    local root=$1
    local pid
    local pgid
    local own_pgid
    PROCESS_TREE_ROOT=$root
    PROCESS_TREE_PIDS=("$root")
    while read -r pid; do
        [[ -n "$pid" ]] || continue
        PROCESS_TREE_PIDS+=("$pid")
    done < <(process_tree_descendants "$root")

    own_pgid=$(ps -o pgid= -p "$$" | tr -d ' ')
    PROCESS_TREE_PGIDS=()
    for pid in "${PROCESS_TREE_PIDS[@]}"; do
        pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
        [[ -n "$pgid" && "$pgid" != "$own_pgid" ]] || continue
        if [[ ! " ${PROCESS_TREE_PGIDS[*]} " =~ " $pgid " ]]; then
            PROCESS_TREE_PGIDS+=("$pgid")
        fi
    done
}

process_tree_has_members() {
    local pid
    local pgid
    for pid in "${PROCESS_TREE_PIDS[@]}"; do
        [[ "$pid" == "$PROCESS_TREE_ROOT" ]] && continue
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    done
    for pgid in "${PROCESS_TREE_PGIDS[@]}"; do
        while read -r pid; do
            [[ -n "$pid" && "$pid" != "$PROCESS_TREE_ROOT" ]] || continue
            return 0
        done < <(pgrep -g "$pgid" 2>/dev/null || true)
    done
    return 1
}

process_tree_wait_until_gone() {
    for _ in {1..50}; do
        if ! process_tree_has_members; then
            return 0
        fi
        sleep 0.02
    done
    return 1
}

process_tree_terminate() {
    local root=$1
    local pid
    local pgid
    local index
    process_tree_snapshot "$root"

    for ((index = ${#PROCESS_TREE_PIDS[@]} - 1; index >= 0; index -= 1)); do
        kill -TERM "${PROCESS_TREE_PIDS[index]}" 2>/dev/null || true
    done
    for pgid in "${PROCESS_TREE_PGIDS[@]}"; do
        kill -TERM -- "-$pgid" 2>/dev/null || true
    done

    process_tree_wait_until_gone && return

    for pid in "${PROCESS_TREE_PIDS[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done
    for pgid in "${PROCESS_TREE_PGIDS[@]}"; do
        kill -KILL -- "-$pgid" 2>/dev/null || true
    done

    process_tree_wait_until_gone
}
