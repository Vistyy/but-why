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

process_tree_terminate() {
    local root=$1
    local pid
    local pgid
    local index
    local remaining
    process_tree_snapshot "$root"
    local pids=("${PROCESS_TREE_PIDS[@]}")
    local pgids=("${PROCESS_TREE_PGIDS[@]}")

    for ((index = ${#pids[@]} - 1; index >= 0; index -= 1)); do
        kill -TERM "${pids[index]}" 2>/dev/null || true
    done
    for pgid in "${pgids[@]}"; do
        kill -TERM -- "-$pgid" 2>/dev/null || true
    done

    for _ in {1..50}; do
        remaining=0
        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                remaining=1
                break
            fi
        done
        if (( remaining == 0 )); then
            for pgid in "${pgids[@]}"; do
                if kill -0 -- "-$pgid" 2>/dev/null; then
                    remaining=1
                    break
                fi
            done
        fi
        (( remaining == 0 )) && return
        sleep 0.02
    done

    for pid in "${pids[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done
    for pgid in "${pgids[@]}"; do
        kill -KILL -- "-$pgid" 2>/dev/null || true
    done
}
