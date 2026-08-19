#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { openHerdrInteractiveSessionHost } from "./change/interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { bestEffortStderrWriter } from "./cli/bestEffortStderr.js";
import { mapRuntimeError, runCli } from "./cli.js";
import { hostInterruptionExitCode, runWithHostInterruption } from "./command/hostInterruption.js";
import { serializeOutput } from "./output/serialize.js";

const executablePath =
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  process.env["BUT_WHY_EXECUTABLE_PATH"] ?? process.argv[1] ?? process.execPath;
const args = process.argv.slice(2);
// biome-ignore lint/complexity/useLiteralKeys: TS index signature
const fixedNow = process.env["BUT_WHY_NOW"];
// biome-ignore lint/complexity/useLiteralKeys: TS index signature
const herdrSocketPath = process.env["HERDR_SOCKET_PATH"];
const interactiveSessionHost = openHerdrInteractiveSessionHost(undefined, {
  ...(herdrSocketPath === undefined ? {} : { socketPath: herdrSocketPath }),
  platform: process.platform,
});
const writeStderr = bestEffortStderrWriter(process.stderr);

void runWithHostInterruption(
  runCli(args, {
    executablePath,
    cwd: process.cwd(),
    globalConfigPath: join(homedir(), ".config/but-why/config.json"),
    now: fixedNow === undefined ? () => new Date() : () => new Date(fixedNow),
    stdin: { fd: 0, isTerminal: process.stdin.isTTY === true },
    interactiveSessionHost,
    writeStderr,
  }),
  (completion) => {
    const result = completion.ok ? completion.value : mapRuntimeError();
    process.stdout.write(serializeOutput(result.stdout));
    process.exitCode = hostInterruptionExitCode(completion.signal, result.exitCode);
  },
  process,
);
