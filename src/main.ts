#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { mapRuntimeError, runCli } from "./cli.js";
import { serializeOutput } from "./output/serialize.js";

const executablePath =
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  process.env["BUT_WHY_EXECUTABLE_PATH"] ?? process.argv[1] ?? process.execPath;
const args = process.argv.slice(2);
// biome-ignore lint/complexity/useLiteralKeys: TS index signature
const fixedNow = process.env["BUT_WHY_NOW"];
const interruption = new AbortController();
let receivedSignal: "SIGINT" | "SIGTERM" | undefined;
const interrupt = (signal: "SIGINT" | "SIGTERM") => {
  receivedSignal = signal;
  interruption.abort();
};
const interruptWithSigint = () => interrupt("SIGINT");
const interruptWithSigterm = () => interrupt("SIGTERM");
process.once("SIGINT", interruptWithSigint);
process.once("SIGTERM", interruptWithSigterm);

Effect.runPromise(
  runCli(args, {
    executablePath,
    cwd: process.cwd(),
    globalConfigPath: join(homedir(), ".config/but-why/config.json"),
    now: fixedNow === undefined ? () => new Date() : () => new Date(fixedNow),
    stdin: { fd: 0, isTerminal: process.stdin.isTTY === true },
    writeStderr: (message) => process.stderr.write(message),
  }),
  { signal: interruption.signal },
)
  .then((result) => {
    process.stdout.write(serializeOutput(result.stdout));
    process.exitCode =
      receivedSignal === "SIGINT" ? 130 : receivedSignal === "SIGTERM" ? 143 : result.exitCode;
  })
  .catch(() => {
    const result = mapRuntimeError();
    process.stdout.write(serializeOutput(result.stdout));
    process.exitCode =
      receivedSignal === "SIGINT" ? 130 : receivedSignal === "SIGTERM" ? 143 : result.exitCode;
  })
  .finally(() => {
    process.off("SIGINT", interruptWithSigint);
    process.off("SIGTERM", interruptWithSigterm);
  });
