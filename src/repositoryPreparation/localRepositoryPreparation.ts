import { spawn } from "node:child_process";

import type { RepositoryPreparationExecutor } from "./runRepositoryPreparation.js";

export const executeLocalRepositoryPreparation: RepositoryPreparationExecutor = (
  command,
  options,
) =>
  new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
