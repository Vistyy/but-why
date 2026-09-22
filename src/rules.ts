import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Data, Effect, Schema } from "effect";
import { type GitError, git } from "./git.js";

const PROJECT_RULES = ".but-why/rules";

const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const ConfigSchema = Schema.fromJsonString(
  Schema.Struct({ rulesDirectory: Schema.optional(Schema.String) }),
);

export interface Rule {
  readonly identity: string;
  readonly provenance: string;
  readonly digest: string;
  readonly text: string;
}

export class PolicyError extends Data.TaggedError("PolicyError")<{
  readonly message: string;
}> {}

function invalid(message: string): PolicyError {
  return new PolicyError({ message });
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Filesystem exceptions are decoded at this trusted configuration boundary.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native filesystem exception boundary.
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class AbsentPath extends Data.TaggedError("AbsentPath")<Record<string, never>> {}

function optionalFile(path: string): Effect.Effect<string | undefined, PolicyError> {
  return Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => (missing(cause) ? new AbsentPath({}) : invalid(`Cannot read ${path}`)),
  }).pipe(Effect.catchTag("AbsentPath", () => Effect.as(Effect.void, undefined)));
}

function globalDirectory(): Effect.Effect<string, PolicyError> {
  // Pi's config directory is user-owned. It is not loaded as agent instructions.
  // oxlint-disable-next-line effecttsgo/process-env
  const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  const configPath = join(homedir(), ".config", "but-why", "config.json");

  return optionalFile(configPath).pipe(
    Effect.flatMap((content) => {
      if (content === undefined) return Effect.succeed(join(agentDir, "but-why", "rules"));

      return Schema.decodeEffect(ConfigSchema)(content).pipe(
        Effect.mapError(() => invalid(`Invalid global config: ${configPath}`)),
        Effect.flatMap((config) => {
          const directory = config.rulesDirectory;

          if (directory === undefined) return Effect.succeed(join(agentDir, "but-why", "rules"));

          if (!isAbsolute(directory))
            return Effect.fail(invalid("rulesDirectory must be absolute"));

          return Effect.succeed(directory);
        }),
      );
    }),
  );
}

function globalRules(directory: string): Effect.Effect<Rule[], PolicyError> {
  const names = Effect.tryPromise({
    try: () => readdir(directory, { withFileTypes: true }),
    catch: (cause) => (missing(cause) ? new AbsentPath({}) : invalid(`Cannot list ${directory}`)),
  }).pipe(Effect.catchTag("AbsentPath", () => Effect.succeed([])));

  return names.pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(
        entries
          .filter((entry) => entry.name.endsWith(".md"))
          .sort((a, b) => a.name.localeCompare(b.name)),
        (entry) => {
          const name = entry.name.slice(0, -3);
          const path = join(directory, entry.name);

          if (!RULE_NAME.test(name))
            return Effect.fail(invalid(`Invalid global rule name: ${path}`));

          if (!entry.isFile())
            return Effect.fail(invalid(`Global rule is not a regular file: ${path}`));

          return Effect.tryPromise({
            try: () => readFile(path, "utf8"),
            catch: () => invalid(`Cannot read global rule: ${path}`),
          }).pipe(
            Effect.map((text) => ({
              identity: `global/${name}`,
              provenance: path,
              digest: digest(text),
              text,
            })),
          );
        },
      ),
    ),
  );
}

function projectRules(cwd: string, pinned: string): Effect.Effect<Rule[], GitError | PolicyError> {
  return git(cwd, ["ls-tree", "-r", "-z", pinned, "--", PROJECT_RULES]).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(
        entries.split("\0").filter((entry) => entry !== ""),
        (entry) =>
          Effect.gen(function* () {
            const match = /^100(?:644|755) blob [a-f0-9]+\t(.+)$/u.exec(entry);
            const path = match?.[1];

            if (
              path === undefined ||
              !path.startsWith(`${PROJECT_RULES}/`) ||
              !path.endsWith(".md")
            )
              return undefined;

            const name = path.slice(PROJECT_RULES.length + 1, -3);

            if (name.includes("/") || !RULE_NAME.test(name))
              return yield* invalid(`Invalid project rule name: ${path}`);

            const text = yield* git(cwd, ["show", `${pinned}:${path}`]);

            return {
              identity: `project/${name}`,
              provenance: `${pinned}:${path}`,
              digest: digest(text),
              text,
            };
          }),
      ),
    ),
    Effect.map((rules) => rules.filter((rule): rule is Rule => rule !== undefined)),
  );
}

/** Resolve policy before creating a reviewer worktree; project policy is pinned to the comparison base. */
export function loadRules(
  cwd: string,
  pinned: string,
): Effect.Effect<Rule[], GitError | PolicyError> {
  return Effect.gen(function* () {
    const directory = yield* globalDirectory();
    const global = yield* globalRules(directory);
    const project = yield* projectRules(cwd, pinned);
    const rules = [...global, ...project];

    if (rules.length === 0) return yield* invalid("No global or project rules found");

    return rules;
  });
}
