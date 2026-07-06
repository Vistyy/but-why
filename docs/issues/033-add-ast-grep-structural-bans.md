# Add ast-grep structural bans

## Status

Done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Add ast-grep for exact forbidden code patterns that are easier to express structurally than through TypeScript, Biome, or Fallow.

This issue is about the local `just quality` command, not the But Why Validation Gate domain concept.

The first rules should protect stable architecture constraints with blocking checks only.

Do not add report-only ast-grep rules in this issue.

Do not duplicate rules that Biome, TypeScript, or Fallow already enforce clearly.

Rules that depend on new seams should be added only after those seams exist.

The scan should cover active production TypeScript source, currently `src/**/*.ts`.

Tests may be used for ast-grep rule fixtures, but this issue should not make normal test source obey production-only structural bans.

The scan should be part of `just quality` and should produce clear diagnostics for agents.

The ast-grep messages should name the seam or helper to use instead of the banned pattern.

## Required rules

- Block `new DatabaseSync(...)` outside `src/init/stateDatabase.ts` and `src/repoState.ts`.
- Block reliable raw SQL call shapes outside `src/init/stateDatabase.ts` and `src/repoState.ts`.
- Reliable SQL call shapes are `.prepare("...")`, `.prepare(`...`)`, `.exec("...")`, and `.exec(`...`)` where the string begins with optional whitespace followed by a SQL verb such as `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `BEGIN`, `COMMIT`, `ROLLBACK`, or `PRAGMA`.
- Rule fixtures should include multiline template SQL with leading whitespace.
- Do not ban every `.exec(...)` call because Sandcastle and command adapters also execute non-SQL commands.
- Block direct process-global access outside `src/main.ts`.
- Process-global access includes `process.env`, `process.argv`, `process.cwd()`, `process.execPath`, `process.stdin`, `process.stdout`, `process.stderr`, `process.exit(...)`, `process.exitCode`, and `process.chdir(...)`.
- Block direct Effect runtime execution outside `src/main.ts`.
- Effect runtime execution includes `Effect.runPromise(...)`, `Effect.runPromiseExit(...)`, `Effect.runSync(...)`, `Effect.runSyncExit(...)`, `Effect.runFork(...)`, and `Effect.runCallback(...)`.
- Block Effect runner imports or aliases that would bypass the runner call rules.
- Do not block ordinary Effect construction or composition outside `src/main.ts`, such as `Effect.succeed(...)`, `Effect.map(...)`, or `Effect.promise(...)`.
- Block output serialization outside output and stdout-boundary seams.
- Output serialization includes `serializeOutput(...)`, `encodeJson(...)`, `encodeToon(...)`, direct TOON `encode(...)`, and direct `JSON.stringify(...)` for CLI output.
- Block output serializer imports or aliases outside their allowed seams so renamed imports cannot bypass the call rules.
- Block direct Sandcastle sandbox factory calls outside `src/validation/createValidationWorkspace.ts`, including `createSandbox(...)` and `noSandbox()`.
- Block Sandcastle factory imports or aliases outside `src/validation/createValidationWorkspace.ts` so renamed imports cannot bypass the call rules.
- Block direct child-process execution outside command adapter seams.
- Child-process execution includes `spawn(...)`, `spawnSync(...)`, `exec(...)`, `execSync(...)`, `execFile(...)`, `execFileSync(...)`, and `fork(...)` from `node:child_process` or `child_process`.
- Block child-process imports or aliases outside command adapter seams so renamed imports cannot bypass the call rules.
- Block inline TypeScript union types containing two or more Task state string literals outside lifecycle and policy seams.
- Do not block every Task state string literal because SQL constraints, CLI help text, and boundary display text may legitimately contain state literals.
- Block raw Task ID parsing outside Task ID and CLI task-resolution seams.
- Raw Task ID parsing includes calls to `parsePublicTaskId(...)`, `publicTaskId(...)`, and `hasPublicTaskIdShape(...)` outside the allowed seams.
- Block local Task ID shape regex helpers outside Task ID and task-resolution seams after the current helper is moved out of init code.
- Block branded Task identity casts outside the Task ID seam, including `as PublicTaskId` and `as TaskSlug`.
- Block known direct operational-name construction shapes that interpolate or concatenate raw Task ID values into branch names, refs, worktree paths, artifact paths, or run names.
- Known raw Task ID naming shapes include template literals, string concatenation, and `path.join(...)` calls containing identifiers such as `taskId`, `input.taskId`, `task.id`, or names ending in `TaskId` when the expression is assigned to or passed as a branch, ref, worktree, artifact path, or run-name value.
- Do not block user-facing messages, help text, diagnostics, or Task Context that include raw Task IDs.
- Rule fixtures should document this rule's syntax limits because ast-grep cannot prove arbitrary dataflow from TypeScript types.
- Block filesystem mutation outside repo init/config seams.
- Filesystem mutation includes `writeFileSync(...)`, `mkdirSync(...)`, `writeFile(...)`, and `mkdir(...)` from `node:fs`, `fs`, `node:fs/promises`, or `fs/promises`.
- Block destructive filesystem APIs in production source.
- Destructive filesystem APIs include `rmSync(...)`, `unlinkSync(...)`, `rmdirSync(...)`, `cpSync(...)`, `copyFileSync(...)`, `renameSync(...)`, `appendFileSync(...)`, `truncateSync(...)`, `mkdtempSync(...)`, `createWriteStream(...)`, `rm(...)`, `unlink(...)`, `rmdir(...)`, `cp(...)`, `copyFile(...)`, `rename(...)`, `appendFile(...)`, `truncate(...)`, and `mkdtemp(...)` from `node:fs`, `fs`, `node:fs/promises`, or `fs/promises`.
- Block raw file reads outside config, gitignore, repo-context discovery, and Task file-input seams.
- Raw file reads include `readFileSync(...)`, `readFile(...)`, `createReadStream(...)`, `statSync(...)`, and `stat(...)` from `node:fs`, `fs`, `node:fs/promises`, or `fs/promises`.
- Block fs namespace, default, dynamic, or require-style imports in production source so named-call rules cannot be bypassed.
- Block named fs import aliases for watched APIs so renamed imports cannot bypass the call rules.
- This import rule covers `node:fs`, `fs`, `node:fs/promises`, and `fs/promises`.
- Block process imports or aliases outside `src/main.ts` so renamed process access cannot bypass the process-global rules.
- Block direct JSON parsing outside repo config and external-tool parser seams.
- Direct JSON parsing is `JSON.parse(...)`.
- Block direct JSON stringification outside repo config and CLI JSON output seams.
- Direct JSON stringification is `JSON.stringify(...)`.
- Block direct wall-clock reads outside `src/main.ts`, including `new Date()` and `Date.now()`.
- Allow timestamp parsing or conversion with `new Date(value)`.

## Allowed files by rule

- SQLite construction and reliable raw SQL calls are allowed only in `src/init/stateDatabase.ts` and `src/repoState.ts`.
- Process-global access and Effect runtime execution are allowed only in `src/main.ts`.
- `serializeOutput(...)` calls are allowed only at the stdout boundary in `src/main.ts`.
- `encodeJson(...)` and `encodeToon(...)` calls are allowed only inside `src/output/serialize.ts`.
- Direct `JSON.stringify(...)` for CLI JSON output is allowed only in `src/output/json.ts`.
- Direct TOON `encode(...)` calls are allowed only in `src/output/toon.ts`.
- Direct Sandcastle sandbox factory calls and factory imports are allowed only in `src/validation/createValidationWorkspace.ts`.
- Direct child-process execution and child-process imports are allowed only in `src/init/git.ts`, `src/submit/gitFacts.ts`, `src/submit/githubTarget.ts`, and `src/validation/validationGitGlue.ts`.
- Inline Task state unions are allowed only in `src/task/lifecycle.ts`, `src/task/startPolicy.ts`, and `src/task/submitPolicy.ts`.
- Raw Task ID parsing is allowed only in `src/task/taskId.ts`, `src/cliTaskId.ts`, and `src/task/repoTaskIds.ts`.
- Local Task ID prefix helpers such as `isPublicTaskIdForPrefix(...)` and `exampleTaskId(...)` are allowed only in `src/task/repoTaskIds.ts` or `src/task/taskId.ts` after they are moved out of init code.
- Branded Task identity casts are allowed only in `src/task/taskId.ts` after current storage hydration is fixed to validate through the seam.
- Raw Task IDs must not be used directly to construct branch names, refs, worktree paths, artifact paths, or run names in any file.
- Operational names may be constructed from Task Slugs or run IDs in the naming seams that own those names, currently `src/repoState.ts` and `src/validation/validationGitGlue.ts`.
- Filesystem mutation is allowed only in `src/init/repoContext.ts`, `src/init/repoConfig.ts`, and `src/init/gitignore.ts`.
- Destructive filesystem APIs are not allowed in production source unless a future issue creates an explicit seam.
- Raw file reads are allowed only in `src/init/repoConfig.ts`, `src/init/gitignore.ts`, `src/task/descriptionFile.ts`, and `src/task/commentFile.ts`.
- `statSync(...)` and `stat(...)` for repo-context discovery are allowed in `src/init/repoContext.ts`.
- `statSync(...)` and `stat(...)` for Task file-input validation are allowed in `src/task/descriptionFile.ts` and `src/task/commentFile.ts`.
- fs namespace, default, dynamic, and require-style imports are not allowed in production source.
- Direct JSON parsing is allowed only in `src/init/repoConfig.ts` and `src/submit/githubTarget.ts`.
- Direct JSON stringification is allowed only in `src/init/repoConfig.ts` and `src/output/json.ts`.
- Direct wall-clock reads with `new Date()` and `Date.now()` are allowed only in `src/main.ts`.
- Timestamp parsing or conversion with `new Date(value)` is allowed in production source.

## Required fixes before enabling rules

- Replace the current `src/repoState.ts` branded Task ID cast with validation through the Task ID seam.
- Move local Task ID prefix helpers such as `isPublicTaskIdForPrefix(...)` and `exampleTaskId(...)` out of `src/init/repoContext.ts` and into a Task ID or task-resolution seam.
- Thread the injected clock to migration application so `schema_migrations.applied_at` uses the same time source as the CLI instead of calling `new Date()` directly.
- `initRepoLocalContext` should receive the command clock from `CliEnvironment` when migrations may run during init.
- `openRepoState` or its input should receive a clock for lazy migration repair.
- `ensureStateDatabase` should accept a clock or timestamp provider and call it at the moment each migration is applied.
- A test should prove `schema_migrations.applied_at` honors `BUT_WHY_NOW`.

## Explicit deferrals

- Do not add a blanket ban on filesystem awareness in this issue.
- Do not block `existsSync` broadly yet because valid existence checks currently live across init, state, submit, task, and validation workspace seams.

## Acceptance criteria

- [x] ast-grep is installed as a development tool.
- [x] ast-grep project configuration exists.
- [x] `just ast-grep-check` runs ast-grep without modifying files.
- [x] `just quality` runs `just ast-grep-check`.
- [x] ast-grep scans active production TypeScript source.
- [x] Normal test source is excluded from production-only structural bans.
- [x] Rule fixtures or equivalent checks prove each rule catches a violation and allows the intended seam.
- [x] Fixtures include alias or import-bypass cases for rules that depend on sensitive imported functions.
- [x] Direct SQLite construction is blocked outside allowed storage or init implementation code.
- [x] Reliable raw SQL call shapes are blocked outside allowed storage or init implementation code.
- [x] Direct process-global access is blocked outside `src/main.ts`.
- [x] Direct Effect runtime execution is blocked outside `src/main.ts`.
- [x] Output serialization is blocked outside output and stdout-boundary seams.
- [x] Direct Sandcastle sandbox factory calls and factory imports are blocked outside the validation workspace seam.
- [x] Direct child-process execution and child-process imports are blocked outside command adapter seams.
- [x] Inline Task state unions are blocked outside lifecycle and policy seams without banning all Task state string literals.
- [x] Raw Task ID parsing is blocked outside Task ID and CLI task-resolution seams.
- [x] Local Task ID prefix helpers live in a Task ID or task-resolution seam before their old location is banned.
- [x] Branded Task identity casts are blocked outside the Task ID seam.
- [x] Known direct branch, ref, worktree path, artifact path, and run-name construction from raw Task IDs is blocked without blocking user-facing Task ID messages.
- [x] Filesystem mutation is blocked outside repo init/config seams.
- [x] Destructive filesystem APIs are blocked in production source.
- [x] Raw file reads are blocked outside config, gitignore, repo-context discovery, and Task file-input seams.
- [x] fs namespace, default, dynamic, and require-style imports are blocked in production source.
- [x] `node:fs/promises` and `fs/promises` are covered by the filesystem import and API rules.
- [x] Direct JSON parsing is blocked outside repo config and external-tool parser seams.
- [x] Direct JSON stringification is blocked outside repo config and CLI JSON output seams.
- [x] Direct wall-clock reads are blocked outside `src/main.ts` while `new Date(value)` remains allowed.
- [x] Migration `applied_at` timestamps use the injected clock before the wall-clock rule is enabled.
- [x] A test proves migration `applied_at` honors `BUT_WHY_NOW`.
- [x] Each rule has a clear message that tells the contributor which seam to use instead.
- [x] `docs/config.md` documents `just ast-grep-check` and ast-grep as part of `just quality` after the rule is enabled.
- [x] Quality passes with the ast-grep rules enabled.

## Blocked by

None.

Prerequisite issues `023`, `024`, and `029` are done.
