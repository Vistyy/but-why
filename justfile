set positional-arguments

quality:
    just format-check
    just lint
    just typecheck
    just test

lint:
    pnpm run lint

typecheck:
    pnpm run typecheck

test:
    pnpm run test

format:
    pnpm run format

format-check:
    pnpm run format-check

[no-exit-message]
by *args:
    @./bin/by "$@"
