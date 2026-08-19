import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { observeUntil } from "./observe.js";
import { startTestProcess } from "./testProcess.js";

const helperPath = fileURLToPath(new URL("./herdrApiServerHelper.mjs", import.meta.url));

export const startFakeHerdrApiServer = async (input: {
  readonly socketPath: string;
  readonly capturePath: string;
  readonly readyPath: string;
}): Promise<{ readonly stop: () => Promise<void> }> => {
  const child = startTestProcess(
    process.execPath,
    [helperPath, input.socketPath, input.capturePath, input.readyPath],
    { cwd: dirname(input.socketPath) },
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
