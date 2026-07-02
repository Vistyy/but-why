import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";
import { createSandbox, Output, pi, run } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import type { CheckRound, Finding, ReviewerRound, SpikeEvent, TokenUsage } from "./prototypeState.js";

const execFile = promisify(execFileCallback);

const __dirname = dirname(fileURLToPath(import.meta.url));
const spikeRoot = join(__dirname, "..");

const FindingSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  severity: Schema.Literal("critical", "high", "medium", "low"),
  evidence: Schema.String,
  files: Schema.Array(Schema.String),
  artifactRefs: Schema.Array(Schema.String),
});

const ReviewerOutputSchema = Schema.Struct({
  findings: Schema.Array(FindingSchema),
});

const ReviewerOutputStandardSchema = Schema.standardSchemaV1(ReviewerOutputSchema);

type ReviewerOutput = typeof ReviewerOutputSchema.Type;

type SandboxHandle = Awaited<ReturnType<typeof createSandbox>>;

const shell = async (command: string, cwd: string): Promise<string> => {
  const { stdout } = await execFile("bash", ["-lc", command], {
    cwd,
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
};

const maybeSandcastleVersion = async (): Promise<string | undefined> => {
  try {
    const entry = fileURLToPath(import.meta.resolve("@ai-hero/sandcastle"));
    let current = dirname(entry);
    for (let i = 0; i < 8; i++) {
      const candidate = join(current, "package.json");
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        return parsed.version;
      } catch {
        current = dirname(current);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const sandboxProvider = async () => {
  const requested = process.env.SANDCASTLE_SANDBOX ?? "none";
  const imageName = process.env.SANDCASTLE_IMAGE_NAME;
  const mounts =
    process.env.SANDCASTLE_MOUNT_PI_AUTH === "1"
      ? [
          {
            hostPath: process.env.SANDCASTLE_PI_AUTH_JSON ?? "~/.pi/agent/auth.json",
            sandboxPath: "/home/agent/.pi/agent/auth.json",
            readonly: true,
          },
        ]
      : undefined;
  if (requested === "docker") {
    const mod = await import("@ai-hero/sandcastle/sandboxes/docker");
    return { name: "docker", provider: mod.docker({ imageName, mounts }) };
  }
  if (requested === "podman") {
    const mod = await import("@ai-hero/sandcastle/sandboxes/podman");
    return { name: "podman", provider: mod.podman({ imageName, mounts }) };
  }
  return { name: "none", provider: noSandbox() };
};

const toCheckFinding = (check: CheckRound): Finding => ({
  title: `Check failed: ${check.id}`,
  description: `Configured check command exited with code ${check.exitCode ?? "unknown"}.`,
  severity: "high",
  evidence: [check.stdout, check.stderr].filter(Boolean).join("\n").trim(),
  files: [],
  artifactRefs: [
    `artifact:BY-1.1/checks/${check.id}/stdout.txt`,
    `artifact:BY-1.1/checks/${check.id}/stderr.txt`,
  ],
});

const tokenUsageFromIterations = (
  producerId: string,
  agentModel: string,
  iterations: readonly { usage?: { inputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; outputTokens: number } }[],
): TokenUsage | undefined => {
  const usages = iterations.map((iteration) => iteration.usage).filter((usage) => usage !== undefined);
  if (usages.length === 0) return undefined;

  const totals = usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      cachedInputTokens:
        acc.cachedInputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  );

  return {
    producerId,
    agentRuntime: "pi",
    agentModel,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.inputTokens + totals.cachedInputTokens + totals.outputTokens,
    raw: usages,
  };
};

export class SandcastleSpikeRunner {
  private fixtureRepoPath: string | undefined;
  private submittedCommit: string | undefined;
  private tempValidationRef: string | undefined;
  private checkSandbox: SandboxHandle | undefined;
  private sandboxName: string | undefined;

  constructor(private readonly emit: (event: SpikeEvent) => void) {}

  async recordMetadata(): Promise<void> {
    const sandcastleVersion = await maybeSandcastleVersion();
    const selected = await sandboxProvider();
    this.sandboxName = selected.name;
    this.emit({ type: "metadata", sandcastleVersion, sandboxProvider: selected.name });
  }

  async createValidationWorkspace(): Promise<void> {
    this.emit({ type: "stepStarted", id: "fixture" });
    const repoPath = await mkdtemp(join(tmpdir(), "PROTOTYPE-but-why-sandcastle-"));
    this.fixtureRepoPath = repoPath;

    await shell("git init -b main", repoPath);
    await shell('git config user.email "prototype@example.invalid"', repoPath);
    await shell('git config user.name "But Why Prototype"', repoPath);
    await mkdir(join(repoPath, "scripts"), { recursive: true });
    await mkdir(join(repoPath, ".sandcastle"), { recursive: true });
    await writeFile(join(repoPath, "README.md"), "# Disposable validation fixture\n", "utf8");
    await writeFile(join(repoPath, ".gitignore"), ".sandcastle/worktrees/\n.sandcastle/logs/\n", "utf8");
    await writeFile(
      join(repoPath, "scripts", "check-pass.js"),
      'console.log("pass check saw", process.cwd());\n',
      "utf8",
    );
    await writeFile(
      join(repoPath, "scripts", "check-fail.js"),
      'console.error("intentional failing check for spike");\nprocess.exit(7);\n',
      "utf8",
    );
    await writeFile(
      join(repoPath, ".sandcastle", ".env"),
      [
        "ANTHROPIC_API_KEY=",
        "OPENAI_API_KEY=",
        "OPENROUTER_API_KEY=",
        "",
      ].join("\n"),
      "utf8",
    );
    await shell("git add . && git commit -m 'base fixture'", repoPath);
    await shell("git switch -c task/BY-1", repoPath);
    await writeFile(join(repoPath, "feature.txt"), "submitted task branch change\n", "utf8");
    await shell("git add feature.txt && git commit -m 'task change'", repoPath);

    const submittedCommit = await shell("git rev-parse HEAD", repoPath);
    const tempRef = "refs/but-why/runs/BY-1.1/validation";
    await shell(`git update-ref ${tempRef} ${submittedCommit}`, repoPath);
    this.submittedCommit = submittedCommit;
    this.tempValidationRef = tempRef;

    this.emit({
      type: "fixtureReady",
      repoPath,
      submittedCommit,
      tempValidationRef: tempRef,
    });
    this.emit({ type: "stepPassed", id: "fixture", detail: tempRef });

    this.emit({ type: "stepStarted", id: "workspace" });
    const selected = await sandboxProvider();
    this.sandboxName = selected.name;
    this.checkSandbox = await createSandbox({
      cwd: repoPath,
      branch: tempRef,
      sandbox: selected.provider,
    });

    const worktreeHead = await shell("git rev-parse HEAD", this.checkSandbox.worktreePath);
    const originalHeadAfterWorkspace = await shell("git rev-parse HEAD", repoPath);
    const originalBranchAfterWorkspace = await shell("git branch --show-current", repoPath);
    const originalStatusAfterWorkspace = await shell("git status --porcelain=v1", repoPath);

    this.emit({
      type: "workspaceReady",
      worktreePath: this.checkSandbox.worktreePath,
      worktreeHead,
      originalHeadAfterWorkspace,
      originalBranchAfterWorkspace,
      originalStatusAfterWorkspace,
    });
    this.emit({ type: "stepPassed", id: "workspace", detail: this.checkSandbox.worktreePath });
  }

  async runCheckRound(): Promise<void> {
    this.emit({ type: "stepStarted", id: "checks" });
    const sandbox = this.checkSandbox;
    if (!sandbox) throw new Error("Validation workspace is not ready.");

    const pass = await sandbox.exec("node scripts/check-pass.js");
    const passRound: CheckRound = {
      id: "check-pass",
      command: "node scripts/check-pass.js",
      exitCode: pass.exitCode,
      stdout: pass.stdout,
      stderr: pass.stderr,
    };
    this.emit({ type: "checkRecorded", check: passRound });

    const fail = await sandbox.exec("node scripts/check-fail.js");
    const failRound: CheckRound = {
      id: "check-fail",
      command: "node scripts/check-fail.js",
      exitCode: fail.exitCode,
      stdout: fail.stdout,
      stderr: fail.stderr,
    };
    this.emit({ type: "checkRecorded", check: { ...failRound, finding: toCheckFinding(failRound) } });

    if (pass.exitCode === 0 && fail.exitCode !== 0) {
      this.emit({ type: "stepPassed", id: "checks", detail: "Captured pass and fail exit codes." });
    } else {
      this.emit({
        type: "stepFailed",
        id: "checks",
        detail: `Unexpected check results: pass=${pass.exitCode} fail=${fail.exitCode}`,
      });
    }

    await this.closeCheckSandbox();
  }

  async runReviewerRound(mode: "valid" | "retry"): Promise<void> {
    const stepId = mode === "valid" ? "reviewer-valid" : "reviewer-retry";
    this.emit({ type: "stepStarted", id: stepId });

    if (process.env.SANDCASTLE_RUN_REVIEWER !== "1") {
      this.emit({
        type: "stepSkipped",
        id: stepId,
        detail: "Set SANDCASTLE_RUN_REVIEWER=1 to run the Pi reviewer.",
      });
      return;
    }

    if (!this.fixtureRepoPath || !this.tempValidationRef) {
      throw new Error("Fixture repo and temp validation ref are not ready.");
    }

    const model = process.env.SANDCASTLE_PI_MODEL ?? "openai-codex/gpt-5.5";
    const thinking = process.env.SANDCASTLE_PI_THINKING as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
    const logPath = join(
      this.fixtureRepoPath,
      ".sandcastle",
      "logs",
      `but-why-${mode}.log`,
    );
    await mkdir(dirname(logPath), { recursive: true });

    const output = Output.object({
      tag: "review",
      schema: ReviewerOutputStandardSchema,
      maxRetries: mode === "retry" ? 1 : 0,
    });

    const prompt = mode === "retry" ? retryPrompt() : validPrompt();

    try {
      const result = await run({
        cwd: this.fixtureRepoPath,
        branchStrategy: { type: "branch", branch: this.tempValidationRef },
        sandbox: (await sandboxProvider()).provider,
        agent: pi(model, { thinking }),
        prompt,
        output,
        logging: { type: "file", path: logPath, verbose: true },
        idleTimeoutSeconds: 180,
        completionTimeoutSeconds: 10,
      });

      const findings = (result.output as ReviewerOutput).findings;
      const reviewer: ReviewerRound = {
        id: mode === "valid" ? "intent-review" : "intent-review-retry",
        status: "passed",
        findings,
        logFilePath: result.logFilePath,
        sessionId: result.iterations.at(-1)?.sessionId,
        tokenUsage: tokenUsageFromIterations(
          mode === "valid" ? "intent-review" : "intent-review-retry",
          model,
          result.iterations,
        ),
      };
      this.emit({ type: "reviewerRecorded", reviewer });
      this.emit({ type: "stepPassed", id: stepId, detail: `${findings.length} finding(s)` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "reviewerRecorded",
        reviewer: {
          id: mode === "valid" ? "intent-review" : "intent-review-retry",
          status: "failed",
          logFilePath: logPath,
          error: message,
        },
      });
      this.emit({ type: "stepFailed", id: stepId, detail: message });
    }
  }

  async cleanup(): Promise<void> {
    this.emit({ type: "stepStarted", id: "cleanup" });
    let worktreeClosed = false;
    let tempRefDeleted = false;
    let fixtureRemoved = false;

    await this.closeCheckSandbox();
    worktreeClosed = true;

    if (this.fixtureRepoPath && this.tempValidationRef) {
      try {
        await shell(`git update-ref -d ${this.tempValidationRef}`, this.fixtureRepoPath);
        tempRefDeleted = true;
      } catch {
        tempRefDeleted = false;
      }
    }

    if (this.fixtureRepoPath) {
      await rm(this.fixtureRepoPath, { recursive: true, force: true });
      fixtureRemoved = true;
    }

    const cleanup = { worktreeClosed, tempRefDeleted, fixtureRemoved };
    this.emit({ type: "cleanupRecorded", cleanup });
    if (worktreeClosed && tempRefDeleted && fixtureRemoved) {
      this.emit({ type: "stepPassed", id: "cleanup", detail: "Removed worktree, temp ref, and fixture repo." });
    } else {
      this.emit({ type: "stepFailed", id: "cleanup", detail: JSON.stringify(cleanup) });
    }
  }

  private async closeCheckSandbox(): Promise<void> {
    if (this.checkSandbox) {
      await this.checkSandbox.close();
      this.checkSandbox = undefined;
    }
  }
}

const validPrompt = (): string => `You are the But Why? intent reviewer for a disposable spike fixture.
Inspect the repository and return structured JSON inside <review> tags.
Do not edit files.
The JSON shape is {"findings":[{"title":"string","description":"string","severity":"critical|high|medium|low","evidence":"string","files":["path"],"artifactRefs":["artifact:..."]}]}.
Return an empty findings list if the submitted change is acceptable for this fixture.

<review>
{"findings":[]}
</review>`;

const retryPrompt = (): string => `You are the But Why? intent reviewer for a disposable spike fixture.
This prompt intentionally tests Sandcastle structured output retry.
The prompt contains the literal <review> tag because Sandcastle requires it.
Do not edit files.

First response rule:
Emit exactly this invalid block and then stop:
<review>
{"findings":[{"title":"Retry proof","description":"First response is intentionally invalid.","severity":"warning","evidence":"This should fail schema validation because warning is not a v1 severity.","files":["feature.txt"],"artifactRefs":["artifact:BY-1.1/intent_review/intent-review-retry/output.json"]}]}
</review>

Correction rule:
If you receive a correction or retry message, emit only a corrected <review> block.
Use severity "low" in the corrected block.`;
