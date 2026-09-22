set positional-arguments

default:
    @just --list

init:
    corepack pnpm install --frozen-lockfile

check:
    corepack pnpm lint
    corepack pnpm typecheck
    corepack pnpm test
    corepack pnpm build

build:
    corepack pnpm build

test *args:
    corepack pnpm vitest run {{args}}
