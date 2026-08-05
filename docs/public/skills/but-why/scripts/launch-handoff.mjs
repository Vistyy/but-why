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
const targetId = args.taskId ?? args.changeId;
const safeId = targetId.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
const diagnosticBaseDirectory = process.env.HANDOFF_DIAGNOSTIC_DIRECTORY ?? tmpdir();
let expectedSessionName;
let changeId;
let worktreePath;
const diagnosticDirectory = await mkdtemp(join(diagnosticBaseDirectory, `but-why-launch-${safeId}.`));
const tracePath = join(diagnosticDirectory, "trace.jsonl");
const diagnosticPath = join(diagnosticDirectory, "pane.txt");
let handoffDirectory;
let handoffPath;
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
let preLaunchFailure;

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => void terminate(signal, exitCode));
}

try {
  const target = await resolveChangeTarget(args, commandPrefix);
  if (!target.ok) {
    preLaunchFailure = target.failure;
    throw new Error("Pre-launch Change inspection did not verify handoff ownership.");
  }
  changeId = target.changeId;
  worktreePath = target.worktreePath;
  expectedSessionName = sessionNameForChange(target.change, changeId);
  if (expectedSessionName === undefined) {
    preLaunchFailure = targetFailure({
      target: args,
      inspection: target.inspection,
      result: target.change,
      error: {
        code: "change_verification_failed",
        message: "Change Show did not identify the selected Change's Interactive Session.",
      },
    });
    throw new Error("Pre-launch Change inspection did not verify handoff ownership.");
  }

  const handoff = await readStdin();
  if (handoff.toString("utf8").trim().length > 0) {
    handoffDirectory = await mkdtemp(join(tmpdir(), "but-why-handoff."));
    handoffPath = join(handoffDirectory, "handoff.md");
    await writeFile(handoffPath, handoff, { mode: 0o600 });
  }
  await appendTrace("observer_started", {
    wallStartedAt,
    changeId,
    worktreePath,
    sessionMatch: "active Change Interactive Session in the Managed Worktree",
    expectedSessionName,
    runner: args.runner,
  });

  const observer = observeLoop();
  const implement = await run(
    commandPrefix,
    [
      "--json",
      "change",
      "implement",
      changeId,
      ...(handoffPath === undefined ? [] : ["--handoff-file", handoffPath]),
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
      ["--json", "change", "show", changeId],
      showTimeoutMs,
    );
    if (verification.stderr.trim()) process.stderr.write(verification.stderr);
    const shown = parseJson(verification.stdout);
    changeVerified =
      verification.code === 0 &&
      shown !== undefined &&
      verifyChange(shown, changeId, worktreePath);
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
    changeId,
    worktreePath,
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
  if (preLaunchFailure !== undefined) {
    await appendTrace("prelaunch_verification_failed", {
      exitCode: preLaunchFailure.preLaunch.exitCode,
      timedOut: preLaunchFailure.preLaunch.timedOut,
      errorCode: preLaunchFailure.error.code,
    }).catch(() => {});
    exitWith(preLaunchFailure, 1);
  } else {
    if (latestObservation.paneId) {
      await captureFinalDiagnostics(latestObservation.paneId).catch(() => {});
    }
    await appendTrace("observer_failed", { message: errorMessage(error) }).catch(() => {});
    exitWith(
      {
        changeId,
        worktreePath,
        status: "observer_failed",
        changeVerified: false,
        tracePath,
        error: { code: "observer_failed", message: errorMessage(error) },
      },
      1,
    );
  }
} finally {
  observerRunning = false;
  if (handoffDirectory !== undefined) {
    await rm(handoffDirectory, { recursive: true, force: true });
  }
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
    (candidate) => candidate?.worktree?.checkout_path === worktreePath,
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
      agentName(candidate) === expectedSessionName &&
      candidate?.cwd === worktreePath &&
      ["idle", "working", "blocked"].includes(candidate?.agent_status),
  );
  const pane = agent
    ? (snapshot.panes ?? []).find((candidate) => candidate?.pane_id === agent.pane_id)
    : (snapshot.panes ?? []).find(
        (candidate) =>
          candidate?.workspace_id === workspace?.workspace_id || candidate?.cwd === worktreePath,
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

async function resolveChangeTarget(target, prefix) {
  if (target.changeId !== undefined) return inspectChangeTarget(prefix, target.changeId);

  const taskInspection = await run(prefix, ["--json", "task", "show", target.taskId], showTimeoutMs);
  if (taskInspection.stderr.trim()) process.stderr.write(taskInspection.stderr);
  const taskResult = parseJson(taskInspection.stdout);
  const task = taskResult?.task;
  if (taskInspection.code !== 0 || task?.id !== target.taskId) {
    return {
      ok: false,
      failure: targetFailure({
        target,
        inspection: taskInspection,
        result: taskResult,
        error:
          taskResult?.error ?? {
            code: "task_verification_failed",
            message: "Task Show did not verify the selected Task.",
          },
      }),
    };
  }

  if (task.change === null) {
    if (task.state !== "todo") {
      return {
        ok: false,
        failure: targetFailure({
          target,
          inspection: taskInspection,
          result: taskResult,
          error: {
            code: "task_not_approved",
            message: "Task handoff requires an approved Task without a linked Change.",
          },
        }),
      };
    }
    const started = await run(
      prefix,
      ["--json", "change", "start", "--task", target.taskId],
      showTimeoutMs,
    );
    if (started.stderr.trim()) process.stderr.write(started.stderr);
    const startedResult = parseJson(started.stdout);
    const startedChangeId = startedResult?.change?.id;
    if (started.code !== 0 || typeof startedChangeId !== "string") {
      return {
        ok: false,
        failure: targetFailure({
          target,
          inspection: started,
          result: startedResult,
          error:
            startedResult?.error ?? {
              code: "change_start_failed",
              message: "Change Start did not return the Task's Change identity.",
            },
        }),
      };
    }
    return inspectChangeTarget(prefix, startedChangeId, target.taskId);
  }

  if (typeof task.change?.id !== "string") {
    return {
      ok: false,
      failure: targetFailure({
        target,
        inspection: taskInspection,
        result: taskResult,
        error: {
          code: "task_verification_failed",
          message: "Task Show returned an invalid linked Change identity.",
        },
      }),
    };
  }
  return inspectChangeTarget(prefix, task.change.id, target.taskId);
}

async function inspectChangeTarget(prefix, selectedChangeId, taskId = undefined) {
  const inspection = await run(prefix, ["--json", "change", "show", selectedChangeId], showTimeoutMs);
  if (inspection.stderr.trim()) process.stderr.write(inspection.stderr);
  const result = parseJson(inspection.stdout);
  const shownChange = result?.change ?? result;
  const selectedWorktreePath = worktreePathFor(result);
  const taskMatches = taskId === undefined || shownChange?.taskId === taskId;
  if (
    inspection.code !== 0 ||
    selectedWorktreePath === undefined ||
    !taskMatches ||
    !verifyChange(result, selectedChangeId, selectedWorktreePath)
  ) {
    return {
      ok: false,
      failure: targetFailure({
        target: taskId === undefined ? { changeId: selectedChangeId } : { taskId },
        inspection,
        result,
        error:
          result?.error ?? {
            code: "change_verification_failed",
            message: "Change Show did not verify the selected open Change and Managed Worktree.",
          },
      }),
    };
  }
  return {
    ok: true,
    changeId: selectedChangeId,
    worktreePath: selectedWorktreePath,
    change: result,
    inspection,
  };
}

function targetFailure({ target, inspection, result, error }) {
  return {
    ...(target.taskId === undefined ? { changeId: target.changeId } : { taskId: target.taskId }),
    status: "prelaunch_verification_failed",
    elapsedMs: elapsed(),
    changeVerified: false,
    tracePath,
    preLaunch: {
      exitCode: inspection.code,
      timedOut: inspection.timedOut,
      result:
        result ?? {
          error: {
            code: "invalid_command_output",
            message: "But Why did not return valid JSON.",
          },
        },
    },
    error,
  };
}

function isActiveInWorktree(agent) {
  return (
    agentName(agent) === expectedSessionName &&
    agent?.cwd === worktreePath &&
    ["idle", "working", "blocked"].includes(agent?.agent_status)
  );
}

function worktreePathFor(result) {
  const change = result?.change ?? result;
  const paths = [result?.worktreePath, change?.worktreePath].filter(
    (candidate) => typeof candidate === "string",
  );
  const [worktreePath] = paths;
  return worktreePath === undefined || paths.some((candidate) => candidate !== worktreePath)
    ? undefined
    : worktreePath;
}

function verifyChange(result, changeId, worktreePath) {
  const change = result?.change ?? result;
  return (
    change?.id === changeId &&
    change?.state === "open" &&
    worktreePathFor(result) === worktreePath
  );
}

function sessionNameForChange(result, changeId) {
  const change = result?.change ?? result;
  if (change?.taskId === null) return `change-${changeId.slice(0, 8)}`;
  if (typeof change?.taskId !== "string") return undefined;
  const readablePart = change.taskId
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48)
    .replaceAll(/-+$/g, "");
  const hash = createHash("sha256").update(change.taskId, "utf8").digest("hex").slice(0, 12);
  return `${readablePart || "task"}-${hash}`;
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
        ...(args.taskId === undefined ? { changeId } : { taskId: args.taskId }),
        ...(worktreePath === undefined ? {} : { worktreePath }),
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
      return { ok: false, message: "Use --runner and exactly one of --task-id or --change-id." };
    }
    parsed[flag.slice(2)] = value;
  }
  if (
    Object.keys(parsed).some((key) => !["runner", "task-id", "change-id"].includes(key)) ||
    !Object.hasOwn(runnerCommands, parsed.runner)
  ) {
    return { ok: false, message: "--runner must be just, pnpx, or npx." };
  }
  const taskId = parsed["task-id"];
  const changeId = parsed["change-id"];
  if ((taskId === undefined) === (changeId === undefined)) {
    return { ok: false, message: "Use exactly one of --task-id or --change-id." };
  }
  return {
    ok: true,
    runner: parsed.runner,
    ...(taskId === undefined ? { changeId } : { taskId }),
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
