#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { mapRuntimeError, runCli } from "./cli.js";
import { outputFormatForArgs } from "./output/selection.js";
import { serializeOutput } from "./output/serialize.js";

const executablePath =
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  process.env["BUT_WHY_EXECUTABLE_PATH"] ?? process.argv[1] ?? process.execPath;
const args = process.argv.slice(2);
// biome-ignore lint/complexity/useLiteralKeys: TS index signature
const fixedNow = process.env["BUT_WHY_NOW"];

Effect.runPromise(
  runCli(args, {
    executablePath,
    cwd: process.cwd(),
    globalConfigPath: join(homedir(), ".config/but-why/config.json"),
    now: fixedNow === undefined ? () => new Date() : () => new Date(fixedNow),
    stdin: { fd: 0, isTerminal: process.stdin.isTTY === true },
    writeStderr: (message) => process.stderr.write(message),
  }),
)
  .then((result) => {
    process.stdout.write(serializeOutput(result.stdout, result.outputFormat ?? "toon"));
    process.exitCode = result.exitCode;
  })
  .catch(() => {
    const result = mapRuntimeError(outputFormatForArgs(args));
    process.stdout.write(serializeOutput(result.stdout, result.outputFormat ?? "toon"));
    process.exitCode = result.exitCode;
  });
