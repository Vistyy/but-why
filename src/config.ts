import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Data, Effect, Schema } from "effect";

const ConfigSchema = Schema.fromJsonString(
  Schema.Struct({
    rulesDirectory: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    extensions: Schema.optional(Schema.Array(Schema.String)),
  }),
);

export interface UserConfig {
  readonly rulesDirectory?: string | undefined;
  readonly model?: string | undefined;
  readonly extensions?: readonly string[] | undefined;
}

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

class ConfigAbsent extends Data.TaggedError("ConfigAbsent")<Record<string, never>> {}

// Native filesystem errors enter as unknown and are classified only at this I/O boundary.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native filesystem exception boundary.
function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Read the user's configuration once per review, never from the audited checkout. */
export const loadConfig: Effect.Effect<UserConfig, ConfigError> = Effect.gen(function* () {
  const path = join(homedir(), ".config", "but-why", "config.json");

  const content = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      absent(cause)
        ? new ConfigAbsent({})
        : new ConfigError({ message: `Cannot read global config: ${path}` }),
  }).pipe(Effect.catchTag("ConfigAbsent", () => Effect.as(Effect.void, undefined)));

  if (content === undefined) return {};

  const config = yield* Schema.decodeEffect(ConfigSchema)(content).pipe(
    Effect.mapError(() => new ConfigError({ message: `Invalid global config: ${path}` })),
  );

  if (config.rulesDirectory !== undefined && !isAbsolute(config.rulesDirectory))
    return yield* new ConfigError({ message: "rulesDirectory must be absolute" });

  if (
    config.extensions?.some(
      (source) =>
        !isAbsolute(source) &&
        !["npm:", "git:", "http://", "https://", "ssh://"].some((prefix) =>
          source.startsWith(prefix),
        ),
    ) === true
  )
    return yield* new ConfigError({
      message: "extensions must be absolute paths or Pi package references",
    });

  return config;
});
