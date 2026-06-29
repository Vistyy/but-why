#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="${SANDCASTLE_IMAGE_NAME:-sandcastle:but-why-spike-pi}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not on PATH" >&2
  exit 127
fi

docker build \
  --build-arg AGENT_UID="$(id -u)" \
  --build-arg AGENT_GID="$(id -g)" \
  -t "$IMAGE_NAME" \
  -f "$SPIKE_DIR/sandbox/Dockerfile" \
  "$SPIKE_DIR"

echo "$IMAGE_NAME"
