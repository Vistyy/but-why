import process from "node:process";
import { applyEvent, initialState, type SpikeEvent, type SpikeState } from "./prototypeState.js";
import { SandcastleSpikeRunner } from "./sandcastleSpike.js";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

let state = initialState();

const emit = (event: SpikeEvent): void => {
  state = applyEvent(state, event);
  if (!process.argv.includes("--all")) render(state);
};

const runner = new SandcastleSpikeRunner(emit);

const render = (current: SpikeState): void => {
  console.clear();
  console.log(`${bold}But Why? Sandcastle v1 execution spike${reset}`);
  console.log(`${dim}PROTOTYPE - throwaway logic prototype for issue 011.${reset}`);
  console.log("");
  console.log(`${bold}Question${reset}`);
  console.log(current.question);
  console.log("");
  console.log(`${bold}Environment${reset}`);
  console.log(`sandcastleVersion: ${current.sandcastleVersion ?? "unknown"}`);
  console.log(`sandboxProvider: ${current.sandboxProvider ?? process.env.SANDCASTLE_SANDBOX ?? "none"}`);
  console.log(`runReviewer: ${process.env.SANDCASTLE_RUN_REVIEWER === "1" ? "yes" : "no"}`);
  console.log("");
  console.log(`${bold}State${reset}`);
  console.log(`fixtureRepoPath: ${current.fixtureRepoPath ?? ""}`);
  console.log(`submittedCommit: ${current.submittedCommit ?? ""}`);
  console.log(`tempValidationRef: ${current.tempValidationRef ?? ""}`);
  console.log(`worktreePath: ${current.worktreePath ?? ""}`);
  console.log(`worktreeHead: ${current.worktreeHead ?? ""}`);
  console.log(`originalHeadAfterWorkspace: ${current.originalHeadAfterWorkspace ?? ""}`);
  console.log(`originalBranchAfterWorkspace: ${current.originalBranchAfterWorkspace ?? ""}`);
  console.log(`originalStatusAfterWorkspace: ${JSON.stringify(current.originalStatusAfterWorkspace ?? "")}`);
  console.log(`cleanup: ${current.cleanup ? JSON.stringify(current.cleanup) : ""}`);
  console.log("");
  console.log(`${bold}Steps${reset}`);
  for (const step of current.steps) {
    console.log(`${statusIcon(step.status)} ${step.id}: ${step.status}${step.detail ? ` ${dim}${step.detail}${reset}` : ""}`);
  }
  console.log("");
  console.log(`${bold}Checks${reset}`);
  if (current.checks.length === 0) console.log(`${dim}(none yet)${reset}`);
  for (const check of current.checks) {
    console.log(`- ${check.id}: exitCode=${check.exitCode} command=${JSON.stringify(check.command)}`);
    if (check.stdout) console.log(`  stdout: ${oneLine(check.stdout)}`);
    if (check.stderr) console.log(`  stderr: ${oneLine(check.stderr)}`);
    if (check.finding) console.log(`  finding: ${check.finding.title}`);
  }
  console.log("");
  console.log(`${bold}Reviewers${reset}`);
  if (current.reviewers.length === 0) console.log(`${dim}(none yet)${reset}`);
  for (const reviewer of current.reviewers) {
    console.log(`- ${reviewer.id}: ${reviewer.status}`);
    if (reviewer.findings) console.log(`  findings: ${reviewer.findings.length}`);
    if (reviewer.logFilePath) console.log(`  logFilePath: ${reviewer.logFilePath}`);
    if (reviewer.sessionId) console.log(`  sessionId: ${reviewer.sessionId}`);
    if (reviewer.tokenUsage) console.log(`  tokenUsage: ${JSON.stringify(reviewer.tokenUsage)}`);
    if (reviewer.error) console.log(`  error: ${oneLine(reviewer.error)}`);
  }
  console.log("");
  console.log(`${bold}Actions${reset}`);
  console.log(`[${bold}m${reset}] ${dim}metadata${reset}  [${bold}w${reset}] ${dim}workspace${reset}  [${bold}c${reset}] ${dim}checks${reset}  [${bold}v${reset}] ${dim}valid reviewer${reset}  [${bold}r${reset}] ${dim}retry reviewer${reset}`);
  console.log(`[${bold}a${reset}] ${dim}run all${reset}  [${bold}x${reset}] ${dim}cleanup${reset}  [${bold}q${reset}] ${dim}quit${reset}`);
};

const statusIcon = (status: string): string => {
  if (status === "passed") return "✓";
  if (status === "failed") return "✗";
  if (status === "running") return "…";
  if (status === "skipped") return "-";
  return " ";
};

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 180);

const runAction = async (key: string): Promise<void> => {
  try {
    if (key === "m") await runner.recordMetadata();
    if (key === "w") await runner.createValidationWorkspace();
    if (key === "c") await runner.runCheckRound();
    if (key === "v") await runner.runReviewerRound("valid");
    if (key === "r") await runner.runReviewerRound("retry");
    if (key === "x") await runner.cleanup();
    if (key === "a") await runAll();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emit({ type: "stepFailed", id: "workspace", detail });
  }
};

const runAll = async (): Promise<void> => {
  await runner.recordMetadata();
  await runner.createValidationWorkspace();
  await runner.runCheckRound();
  await runner.runReviewerRound("valid");
  await runner.runReviewerRound("retry");
  await runner.cleanup();
};

const main = async (): Promise<void> => {
  if (process.argv.includes("--all")) {
    await runAll();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  render(state);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    const key = String(chunk);
    if (key === "\u0003" || key === "q") {
      process.stdin.setRawMode(false);
      process.exit(0);
    }
    void runAction(key);
  });
};

await main();
