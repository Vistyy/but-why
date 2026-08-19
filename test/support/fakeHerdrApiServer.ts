import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { observeUntil } from "./observe.js";

const helperPath = fileURLToPath(new URL("./herdrApiServerHelper.mjs", import.meta.url));

export const startFakeHerdrApiServer = async (input: {
  readonly socketPath: string;
  readonly capturePath: string;
  readonly readyPath: string;
}): Promise<{ readonly stop: () => Promise<void> }> => {
  const child = spawn(
    process.execPath,
    [helperPath, input.socketPath, input.capturePath, input.readyPath],
    { stdio: "ignore" },
  );
  await observeUntil({
    description: `fake Herdr API socket ${input.socketPath}`,
    observe: () => existsSync(input.readyPath),
    timeoutMs: 5_000,
  });
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
};
