#!/usr/bin/env bash
set -euo pipefail

COMMIT="2d93226d37da129c54d4ecfd5b370122b48b31b2"
TARBALL="/tmp/but-why-ai-hero-sandcastle-main-${COMMIT}.tgz"
REFERENCE="${SANDCASTLE_REFERENCE:-$HOME/projects/references/sandcastle}"
BUILD_DIR="/tmp/but-why-sandcastle-main-build"

if [[ -f "$TARBALL" ]]; then
  echo "Using existing Sandcastle main tarball: $TARBALL" >&2
  exit 0
fi

if [[ ! -d "$REFERENCE/.git" ]]; then
  mkdir -p "$(dirname "$REFERENCE")"
  git clone https://github.com/mattpocock/sandcastle.git "$REFERENCE"
fi

git -C "$REFERENCE" fetch origin main:refs/heads/main
git -C "$REFERENCE" checkout main
git -C "$REFERENCE" reset --hard "$COMMIT"

rm -rf "$BUILD_DIR"
cp -a "$REFERENCE" "$BUILD_DIR"
cd "$BUILD_DIR"

node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); p.packageManager="pnpm@11.5.3"; fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\n");'

pnpm install --frozen-lockfile=false || true
pnpm approve-builds @parcel/watcher esbuild msgpackr-extract protobufjs || true
pnpm install --frozen-lockfile=false
pnpm add @standard-schema/spec
pnpm build
pnpm pack --pack-destination /tmp
cp /tmp/ai-hero-sandcastle-0.11.0.tgz "$TARBALL"

echo "Built Sandcastle main tarball: $TARBALL" >&2
