#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const runnerCommands = {
  just: ["just", "by"],
  pnpx: ["pnpx", "but-why"],
  npx: ["npx", "-y", "but-why"],
};

const pollMs = positiveInteger(process.env.HANDOFF_OBSERVER_POLL_MS, 250);
const lateGraceMs = positiveInteger(process.env.HANDOFF_OBSERVER_LATE_GRACE_MS, 15_000);
const slowMs = positiveInteger(process.env.HANDOFF_OBSERVER_SLOW_MS, 5_000);
const implementTimeoutMs = positiveInteger(
  process.env.HANDOFF_OBSERVER_IMPLEMENT_TIMEOUT_MS,
  60_000,
);
const showTimeoutMs = positiveInteger(process.env.HANDOFF_OBSERVER_SHOW_TIMEOUT_MS, 15_000);
const maxCapturedBytes = 1024 * 1024;
const maxTraceBytes = 1024 * 1024;

const args = parseArgs(process.argv.slice(2));
if (!args.ok) {
  process.stdout.write(
    `${JSON.stringify({ error: { code: "usage", message: args.message } }, null, 2)}\n`,
  );
  process.exit(2);
}

const commandPrefix = runnerCommands[args.runner];
const startedAt = performance.now();
const wallStartedAt = new Date().toISOString();
const safeId = args.changeId.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
const diagnosticDirectory = await mkdtemp(join(tmpdir(), `but-why-launch-${safeId}.`));
const tracePath = join(diagnosticDirectory, "trace.jsonl");
const diagnosticPath = join(diagnosticDirectory, "pane.txt");
const handoffDirectory = await mkdtemp(join(tmpdir(), "but-why-handoff."));
const handoffPath = join(handoffDirectory, "handoff.md");
const activeChildren = new Set();
let observerRunning = true;
let preserveTrace = false;
let diagnosticAvailable = false;
let terminating = false;
let latestObservation = {};
let previousObservationKey;
let previousProgressKey;
let lastPressureAt = 0;
let traceBytes = 0;

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => void terminate(signal, exitCode));
}

try {
  const handoff = await readStdin();
  await writeFile(handoffPath, handoff, { mode: 0o600 });
  await appendTrace("observer_started", {
    wallStartedAt,
    changeId: args.changeId,
    worktreePath: args.worktreePath,
    sessionMatch: "active agent in the Managed Worktree",
    runner: args.runner,
  });

  const observer = observeLoop();
  const implement = await run(
    commandPrefix,
    [
      "--json",
      "change",
      "implement",
      args.changeId,
      "--handoff-file",
      handoffPath,
    ],
    implementTimeoutMs,
  );
  if (terminating) await new Promise(() => {});
  await appendTrace("change_implement_exited", {
    exitCode: implement.code,
    elapsedMs: elapsed(),
  });

  if (implement.stderr.trim()) process.stderr.write(implement.stderr);
  const parsedImplementResult = parseJson(implement.stdout);
  const implementResult = implement.timedOut
    ? {
        error: {
          code: "launch_indeterminate",
          message: "Change Implement exceeded the companion script deadline.",
        },
      }
    : parsedImplementResult;
  const implementStatus = implementResult?.status;
  const errorCode = implementResult?.error?.code;
  let status = implementStatus;

  if (errorCode === "launch_indeterminate") {
    preserveTrace = true;
    const deadline = performance.now() + lateGraceMs;
    await appendTrace("late_observation_started", { graceMs: lateGraceMs });
    while (performance.now() < deadline && !isActiveInWorktree(latestObservation.agent)) {
      await sleep(Math.min(pollMs, Math.max(1, deadline - performance.now())));
    }
    if (isActiveInWorktree(latestObservation.agent)) {
      status = "late_active";
      await appendTrace("late_session_active", {
        elapsedMs: elapsed(),
        paneId: latestObservation.agent.pane_id,
        agentStatus: latestObservation.agent.agent_status,
      });
    } else {
      status = "launch_indeterminate";
    }
  }

  observerRunning = false;
  await observer;

  const successfulLaunch = ["started", "already_active", "late_active"].includes(status);
  let changeVerified = false;
  let verification;
  if (successfulLaunch) {
    verification = await run(
      commandPrefix,
      ["--json", "change", "show", args.changeId],
      showTimeoutMs,
    );
    if (verification.stderr.trim()) process.stderr.write(verification.stderr);
    const shown = parseJson(verification.stdout);
    changeVerified =
      verification.code === 0 &&
      shown !== undefined &&
      verifyChange(shown, args.changeId, args.worktreePath);
    await appendTrace("change_verification", {
      exitCode: verification.code,
      verified: changeVerified,
    });
  }

  const elapsedMs = elapsed();
  preserveTrace ||= elapsedMs >= slowMs || !successfulLaunch || !changeVerified;
  if (preserveTrace && latestObservation.paneId) {
    diagnosticAvailable = await captureFinalDiagnostics(latestObservation.paneId);
  }

  const output = {
    changeId: args.changeId,
    worktreePath: args.worktreePath,
    status: status ?? errorCode ?? "launch_failed",
    elapsedMs,
    changeVerified,
    ...(preserveTrace ? { tracePath } : {}),
    ...(diagnosticAvailable ? { diagnosticPath } : {}),
    implement: implementResult ?? {
      error: {
        code: "invalid_command_output",
        message: "Change Implement did not return valid JSON.",
      },
    },
  };

  if (!preserveTrace) await rm(diagnosticDirectory, { recursive: true, force: true });
  exitWith(output, successfulLaunch && changeVerified ? 0 : 1);
} catch (error) {
  preserveTrace = true;
  observerRunning = false;
  for (const activeChild of activeChildren) killProcessTree(activeChild);
  if (latestObservation.paneId) {
    await captureFinalDiagnostics(latestObservation.paneId).catch(() => {});
  }
  await appendTrace("observer_failed", { message: errorMessage(error) }).catch(() => {});
  exitWith(
    {
      changeId: args.changeId,
      worktreePath: args.worktreePath,
      status: "observer_failed",
      changeVerified: false,
      tracePath,
      error: { code: "observer_failed", message: errorMessage(error) },
    },
    1,
  );
} finally {
  observerRunning = false;
  await rm(handoffDirectory, { recursive: true, force: true });
}

async function observeLoop() {
  while (observerRunning) {
    const before = performance.now();
    await observeOnce().catch(async (error) => {
      await appendTrace("observation_error", { message: errorMessage(error) });
    });
    const delay = Math.max(1, pollMs - (performance.now() - before));
    if (observerRunning) await sleep(delay);
  }
}

async function observeOnce() {
  const snapshotResult = await run(["herdr"], ["api", "snapshot"], 1_500);
  if (snapshotResult.code !== 0) {
    await appendTrace("herdr_unavailable", { exitCode: snapshotResult.code });
    return;
  }
  const snapshot = parseJson(snapshotResult.stdout)?.result?.snapshot;
  if (!snapshot) {
    await appendTrace("herdr_snapshot_invalid", {});
    return;
  }

  const workspace = (snapshot.workspaces ?? []).find(
    (candidate) => candidate?.worktree?.checkout_path === args.worktreePath,
  );
  const agents = (snapshot.agents ?? []).map((candidate) => ({
    name: agentName(candidate),
    cwd: candidate?.cwd,
    paneId: candidate?.pane_id,
    agentStatus: candidate?.agent_status,
    agentSessionPath: candidate?.agent_session?.value,
  }));
  const agent = (snapshot.agents ?? []).find(
    (candidate) =>
      candidate?.cwd === args.worktreePath &&
      ["idle", "working", "blocked"].includes(candidate?.agent_status),
  );
  const pane = agent
    ? (snapshot.panes ?? []).find((candidate) => candidate?.pane_id === agent.pane_id)
    : (snapshot.panes ?? []).find(
        (candidate) =>
          candidate?.workspace_id === workspace?.workspace_id || candidate?.cwd === args.worktreePath,
      );
  const paneId = agent?.pane_id ?? pane?.pane_id;
  const observation = {
    workspaceId: workspace?.workspace_id,
    paneId,
    agent,
  };
  const observationKey = JSON.stringify({
    workspaceId: observation.workspaceId,
    paneId,
    agentStatus: agent?.agent_status,
    agentSession: agent?.agent_session?.value,
    agents,
  });
  if (observationKey !== previousObservationKey) {
    await appendTrace("herdr_state", {
      workspaceId: observation.workspaceId,
      paneId,
      agentStatus: agent?.agent_status,
      agentSessionPath: agent?.agent_session?.value,
      agents,
    });
    previousObservationKey = observationKey;
  }
  latestObservation = observation;

  if (paneId) {
    const [processResult, outputResult] = await Promise.all([
      run(["herdr"], ["pane", "process-info", "--pane", paneId], 1_500),
      run(
        ["herdr"],
        ["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "200", "--format", "text"],
        1_500,
      ),
    ]);
    const processNames =
      processResult.code === 0 ? collectProcessNames(parseJson(processResult.stdout)) : [];
    const outputHash =
      outputResult.code === 0
        ? createHash("sha256").update(outputResult.stdout).digest("hex").slice(0, 16)
        : undefined;
    const progressKey = JSON.stringify({ processNames, outputHash });
    if (progressKey !== previousProgressKey) {
      await appendTrace("pane_progress", {
        paneId,
        processNames,
        outputHash,
        outputBytes: outputResult.code === 0 ? Buffer.byteLength(outputResult.stdout) : undefined,
      });
      previousProgressKey = progressKey;
    }
  }

  if (performance.now() - lastPressureAt >= 1_000) {
    lastPressureAt = performance.now();
    await appendTrace("host_pressure", await hostPressure());
  }
}

async function captureFinalDiagnostics(paneId) {
  const output = await run(
    ["herdr"],
    ["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "200", "--format", "text"],
    2_000,
  );
  if (output.code === 0) {
    await writeFile(diagnosticPath, output.stdout, { mode: 0o600 });
    await chmod(diagnosticPath, 0o600);
    return true;
  }
  return false;
}

async function hostPressure() {
  const [load, cpu, io, memory] = await Promise.all([
    readFile("/proc/loadavg", "utf8").catch(() => undefined),
    readFile("/proc/pressure/cpu", "utf8").catch(() => undefined),
    readFile("/proc/pressure/io", "utf8").catch(() => undefined),
    readFile("/proc/pressure/memory", "utf8").catch(() => undefined),
  ]);
  return {
    loadavg: load?.trim(),
    cpu: cpu?.trim(),
    io: io?.trim(),
    memory: memory?.trim(),
  };
}

function isActiveInWorktree(agent) {
  return (
    agent?.cwd === args.worktreePath &&
    ["idle", "working", "blocked"].includes(agent?.agent_status)
  );
}

function verifyChange(result, changeId, worktreePath) {
  const change = result.change ?? result;
  const paths = [result.worktreePath, change.worktreePath].filter(
    (candidate) => candidate !== undefined,
  );
  return (
    change.id === changeId &&
    change.state === "open" &&
    change.readiness === "ready" &&
    paths.length > 0 &&
    paths.every((candidate) => candidate === worktreePath)
  );
}

function agentName(agent) {
  return agent?.name ?? agent?.agent;
}

async function appendTrace(event, details) {
  const record = `${JSON.stringify({
    tMs: elapsed(),
    at: new Date().toISOString(),
    event,
    ...details,
  })}\n`;
  const recordBytes = Buffer.byteLength(record);
  if (traceBytes + recordBytes > maxTraceBytes) return;
  await appendFile(tracePath, record, { mode: 0o600 });
  traceBytes += recordBytes;
}

function elapsed() {
  return Math.round(performance.now() - startedAt);
}

function run(prefix, commandArgs, timeout = undefined) {
  return new Promise((resolve, reject) => {
    const [executable, ...prefixArgs] = prefix;
    const output = [];
    const errors = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let timedOut = false;
    const processChild = spawn(executable, [...prefixArgs, ...commandArgs], {
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(processChild);
    processChild.stdout.on("data", (chunk) => {
      if (outputBytes >= maxCapturedBytes) return;
      const bounded = chunk.subarray(0, maxCapturedBytes - outputBytes);
      output.push(bounded);
      outputBytes += bounded.length;
    });
    processChild.stderr.on("data", (chunk) => {
      if (errorBytes >= maxCapturedBytes) return;
      const bounded = chunk.subarray(0, maxCapturedBytes - errorBytes);
      errors.push(bounded);
      errorBytes += bounded.length;
    });
    processChild.on("error", reject);
    let timer;
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(processChild);
      }, timeout);
    }
    processChild.on("close", (code) => {
      activeChildren.delete(processChild);
      if (timer) clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        timedOut,
        stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"),
      });
    });
  });
}

async function terminate(signal, exitCode) {
  if (terminating) return;
  terminating = true;
  preserveTrace = true;
  observerRunning = false;
  for (const activeChild of activeChildren) killProcessTree(activeChild);
  await appendTrace("observer_interrupted", { signal }).catch(() => {});
  await rm(handoffDirectory, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        changeId: args.changeId,
        worktreePath: args.worktreePath,
        status: "observer_interrupted",
        changeVerified: false,
        tracePath,
        error: { code: "observer_interrupted", message: `Received ${signal}.` },
      },
      null,
      2,
    )}\n`,
  );
  process.exit(exitCode);
}

function killProcessTree(processChild) {
  if (processChild.exitCode !== null || processChild.pid === undefined) return;
  try {
    process.kill(-processChild.pid, "SIGTERM");
  } catch {
    processChild.kill("SIGTERM");
  }
}

function collectProcessNames(value) {
  const names = new Set();
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    if (typeof candidate.name === "string") names.add(candidate.name);
    for (const nested of Object.values(candidate)) visit(nested);
  };
  visit(value);
  return [...names].sort();
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      return { ok: false, message: "Use --runner, --change-id, and --worktree-path." };
    }
    parsed[flag.slice(2)] = value;
  }
  if (!Object.hasOwn(runnerCommands, parsed.runner)) {
    return { ok: false, message: "--runner must be just, pnpx, or npx." };
  }
  if (!parsed["change-id"] || !parsed["worktree-path"]) {
    return { ok: false, message: "--change-id and --worktree-path are required." };
  }
  return {
    ok: true,
    runner: parsed.runner,
    changeId: parsed["change-id"],
    worktreePath: parsed["worktree-path"],
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value.trim());
  } catch {
    return undefined;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function exitWith(value, code) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = code;
}
