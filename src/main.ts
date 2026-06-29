import { Effect } from "effect";

import { mapRuntimeError, runCli } from "./cli.js";
import { encodeToon } from "./output/toon.js";

const executablePath = process.env.BUT_WHY_EXECUTABLE_PATH ?? process.argv[1] ?? process.execPath;
const args = process.argv.slice(2);

Effect.runPromise(
  runCli(args, {
    executablePath,
    cwd: process.cwd(),
  }),
)
  .then((result) => {
    process.stdout.write(encodeToon(result.stdout));
    process.exitCode = result.exitCode;
  })
  .catch(() => {
    const result = mapRuntimeError();
    process.stdout.write(encodeToon(result.stdout));
    process.exitCode = result.exitCode;
  });
