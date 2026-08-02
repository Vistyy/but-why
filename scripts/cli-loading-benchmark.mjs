import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const directory = mkdtempSync(join(tmpdir(), "but-why-cli-benchmark-"));
const baseline = join(repoRoot, ".cli-loading-baseline");
const commands = [
  ["--help"],
  ["--version"],
  ["task", "list"],
  ["change", "list"],
  ["validation-run", "show", "missing"],
];
const processesPerCommand = 15;

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

try {
  execFileSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const tarball = join(directory, "but-why-0.0.1.tgz");
  const consumer = join(directory, "consumer");
  execFileSync("mkdir", ["-p", consumer]);
  execFileSync("pnpm", ["add", "--dir", consumer, tarball], { cwd: directory, stdio: "inherit" });
  rmSync(baseline, { recursive: true, force: true });
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--outDir", baseline], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  const installedBy = join(consumer, "node_modules/.bin/by");
  execFileSync("git", ["init", "-q"], { cwd: consumer });
  execFileSync(installedBy, ["init", "--task-prefix", "BY"], { cwd: consumer, stdio: "ignore" });
  const runs = [
    ...commands.map((args) => ({ executable: "compiledExecutable", args })),
    ...commands.map((args) => ({ executable: "installedPackageTarball", args })),
  ];
  for (let index = runs.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [runs[index], runs[swapIndex]] = [runs[swapIndex], runs[index]];
  }

  const measurements = new Map();
  for (const run of runs) {
    const key = `${run.executable}:${run.args.join(" ")}`;
    const values = measurements.get(key) ?? [];
    for (let repeat = 0; repeat < processesPerCommand; repeat += 1) {
      const executable = run.executable === "compiledExecutable" ? process.execPath : installedBy;
      const args = run.executable === "compiledExecutable" ? [join(baseline, "main.js"), ...run.args] : run.args;
      const started = process.hrtime.bigint();
      const result = spawnSync(executable, args, { cwd: consumer, encoding: "utf8" });
      if (result.status !== (run.args[0] === "validation-run" ? 1 : 0)) {
        throw new Error(`${key} exited with ${result.status}: ${result.stderr}`);
      }
      values.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }
    measurements.set(key, values);
  }

  console.log(
    JSON.stringify({
      benchmark: "cli-loading",
      method: { processesPerCommand, order: "randomized" },
      medianMilliseconds: Object.fromEntries(
        [...measurements].map(([key, values]) => [key, median(values)]),
      ),
    }),
  );
} finally {
  rmSync(baseline, { recursive: true, force: true });
  rmSync(directory, { recursive: true, force: true });
}
