set positional-arguments

default:
    @just --list

init:
    pnpm install --frozen-lockfile

check:
    pnpm exec effect-tsgo patch --oxlint --no-typescript
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build
    node scripts/test-cli-process.mjs
    git diff --check

build:
    pnpm build

test *args:
    pnpm vitest run {{args}}
