set positional-arguments

default:
    @just --list

init:
    corepack pnpm install --frozen-lockfile

check:
    corepack pnpm exec effect-tsgo patch --oxlint --no-typescript
    corepack pnpm lint
    corepack pnpm typecheck
    corepack pnpm test
    corepack pnpm build
    node scripts/test-cli-process.mjs
    git diff --check

build:
    corepack pnpm build

test *args:
    corepack pnpm vitest run {{args}}
