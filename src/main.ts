import { Effect } from "effect";

import { mapRuntimeError, runCli } from "./cli.js";
import { encodeToon } from "./output/toon.js";

const executablePath = process.env.BUT_WHY_EXECUTABLE_PATH ?? process.argv[1] ?? process.execPath;
const args = process.argv.slice(2);
const fixedNow = process.env.BUT_WHY_NOW;

Effect.runPromise(
  runCli(args, {
    executablePath,
    cwd: process.cwd(),
    now: fixedNow === undefined ? () => new Date() : () => new Date(fixedNow),
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
