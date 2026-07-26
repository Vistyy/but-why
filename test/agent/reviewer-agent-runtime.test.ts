import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";

const profile = {
  agentRuntime: "pi" as const,
  agentModel: "openai-codex/gpt-5.5",
  thinking: "high" as const,
};

describe("Pi reviewer agent runtime", () => {
  it.effect("runs a role prompt and decodes trustworthy reviewer output", () =>
    Effect.gen(function* () {
      let prompt = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        prompt = options.prompt ?? "";
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Judge only approved intent for the exact Candidate.",
        profile,
      });

      expect(result).toEqual({
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
      });
      expect(prompt).toBe("Judge only approved intent for the exact Candidate.");
    }),
  );

  it.effect("launches reviewers with an isolated Pi resource and tool boundary", () =>
    Effect.gen(function* () {
      let command = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        const built = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        });
        command = built.command;
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "specialist:security",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
        agentEnvironment: ["nix", "develop", "-c"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(command).toBe(
        "'nix' 'develop' '-c' pi -p --mode json --model 'openai-codex/gpt-5.5' --thinking high --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tools read,bash,grep,find,ls",
      );
      expect(command).not.toContain("--subagent");
      expect(command).not.toContain("--edit");
      expect(command).not.toContain("--write");
    }),
  );

  it.effect("stops after a configured Agent Environment launch failure", () =>
    Effect.gen(function* () {
      let attempts = 0;
      let command = "";
      const result = yield* piReviewerAgentRuntime.review({
        sandbox: {
          run: async (options: Parameters<Pick<Sandbox, "run">["run"]>[0]) => {
            attempts += 1;
            command = options.agent.buildPrintCommand({
              prompt: options.prompt ?? "",
              dangerouslySkipPermissions: true,
            }).command;
            throw new Error("wrapper failed");
          },
        } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
        agentEnvironment: ["nix", "develop", "-c"],
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 1,
        failure: { _tag: "SandcastleToolingFailed", message: "wrapper failed" },
      });
      expect(command.startsWith("'nix' 'develop' '-c' pi ")).toBe(true);
      expect(attempts).toBe(1);
    }),
  );

  it.effect("proves normal Pi resources are unavailable in the reviewer process", () =>
    Effect.gen(function* () {
      const home = mkdtempSync(join(tmpdir(), "but-why-reviewer-pi-"));
      const workspace = mkdtempSync(join(tmpdir(), "but-why-reviewer-workspace-"));
      const extensionDir = join(home, ".pi", "agent", "extensions");
      const probeExtension = join(home, "probe.ts");
      const probeOutput = join(home, "probe.json");
      const skillDir = join(home, ".pi", "agent", "skills", "user-normal-skill");
      const promptDir = join(home, ".pi", "agent", "prompts");
      const themeDir = join(home, ".pi", "agent", "themes");
      mkdirSync(extensionDir, { recursive: true });
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(promptDir, { recursive: true });
      mkdirSync(themeDir, { recursive: true });
      writeFileSync(
        join(extensionDir, "user-normal.ts"),
        'export default function userNormal(pi) { pi.registerCommand("user-normal-extension", { description: "User normal extension" }); }\n',
      );
      writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: User normal skill\n---\n");
      writeFileSync(
        join(promptDir, "user-normal-prompt.md"),
        "---\ndescription: User normal prompt\n---\n",
      );
      writeFileSync(join(themeDir, "user-normal.json"), "{}\n");
      writeFileSync(join(home, "AGENTS.md"), "USER_NORMAL_CONTEXT_MARKER\n");
      writeFileSync(join(workspace, "AGENTS.md"), "CANDIDATE_CONTEXT_MARKER\n");
      writeFileSync(
        probeExtension,
        [
          'import { writeFileSync } from "node:fs";',
          "export default function probe(pi) {",
          '  pi.registerTool({ name: "subagent", label: "Subagent", description: "probe", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) });',
          '  pi.registerCommand("probe-command", { description: "probe", handler: async (_args, ctx) => { writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify({ prompt: ctx.getSystemPrompt(), tools: pi.getActiveTools() })); } });',
          "}",
          "",
        ].join("\n"),
      );

      let command = "";
      let processOutput = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        const built = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        });
        command = built.command;
        const rpcCommand = `${built.command.replace("pi -p --mode json", "pi --mode rpc --no-session")} --extension ${probeExtension}`;
        const spawned = spawnSync("sh", ["-c", rpcCommand], {
          cwd: workspace,
          env: { ...process.env, HOME: home, PI_OFFLINE: "1", PROBE_OUTPUT: probeOutput },
          input:
            '{"type":"get_commands","id":"commands"}\n{"type":"prompt","message":"/probe-command","id":"probe"}\n',
          encoding: "utf8",
          timeout: 10_000,
        });
        if (spawned.error) throw spawned.error;
        if (spawned.status !== 0) {
          throw new Error(spawned.stderr || `Pi exited with ${spawned.status}`);
        }
        processOutput = spawned.stdout;
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          validationRunId: "123e4567-e89b-42d3-a456-426614174000",
          availableArtifactRefs: [],
          prompt: "Review the Candidate.",
          profile,
        });

        expect(result).toMatchObject({ ok: true, attempts: 1 });
        expect(command).toContain("--no-extensions");
        expect(command).toContain("--no-skills");
        expect(command).toContain("--no-prompt-templates");
        expect(command).toContain("--no-themes");
        expect(command).toContain("--no-context-files");
        const probe = JSON.parse(readFileSync(probeOutput, "utf8")) as {
          readonly prompt: string;
          readonly tools: readonly string[];
        };
        expect(processOutput).not.toContain("user-normal-extension");
        expect(processOutput).not.toContain("user-normal-skill");
        expect(processOutput).not.toContain("user-normal-prompt");
        expect(probe.prompt).not.toContain("USER_NORMAL_CONTEXT_MARKER");
        expect(probe.prompt).not.toContain("CANDIDATE_CONTEXT_MARKER");
        expect(probe.tools).toEqual(["read", "bash", "grep", "find", "ls"]);
        expect(probe.tools).not.toContain("subagent");
        expect(probe.tools).not.toContain("edit");
        expect(probe.tools).not.toContain("write");
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
      }
    }),
  );

  it.effect("retries a dangling Artifact reference and accepts the corrected report", () =>
    Effect.gen(function* () {
      const corrected = runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resume = vi.fn(() => Promise.resolve(corrected));
      const dangling = runResult(
        '<reviewer-output>{"findings":[{"title":"Mismatch","description":"Incomplete behavior.","severity":"high","evidence":"Missing output.","files":[],"artifactRefs":["artifact:123e4567-e89b-42d3-a456-426614174000/checks/missing/stdout.txt"]}]}</reviewer-output>',
        resume,
      );

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: {
          run: () => Promise.resolve(dangling),
        } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, attempts: 2, report: { findings: [] } });
      expect(resume).toHaveBeenCalledWith(expect.stringContaining("does not resolve"));
    }),
  );

  it.effect("fails tooling after one output correction", () =>
    Effect.gen(function* () {
      const third = runResult("must not run");
      const resumeAfterCorrection = vi.fn(() => Promise.resolve(third));
      const second = runResult("invalid again", resumeAfterCorrection);
      const first = runResult("invalid", () => Promise.resolve(second));
      const run = vi.fn(() => Promise.resolve(first));

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 2,
        failure: {
          _tag: "ReviewerOutputContractFailed",
          reviewer: "acceptance",
          attempts: 2,
        },
      });
      expect(resumeAfterCorrection).not.toHaveBeenCalled();
    }),
  );
});

const runResult = (stdout: string, resume?: SandboxRunResult["resume"]): SandboxRunResult => ({
  iterations: [],
  stdout,
  commits: [],
  ...(resume === undefined ? {} : { resume }),
});
