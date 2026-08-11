import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createPiReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import { decodeReviewerOutputContract } from "../../src/agent/reviewerOutput.js";
import { buildReviewerOutputCorrectionPrompt } from "../../src/reviewerPrompts/reviewerPromptSupport.js";

const decodeEmptyFindings = (output: unknown) =>
  decodeReviewerOutputContract({ reviewer: "acceptance", attempts: 1, output }).pipe(
    Effect.mapError(
      (failure) =>
        new ReviewerExecutionFailed({
          kind: "output_contract",
          operationName: failure.operationName,
          message: failure.message,
          diagnostics: failure.diagnostics,
          correctionPrompt: buildReviewerOutputCorrectionPrompt(failure),
        }),
    ),
  );

import { runTestProcess } from "../support/testProcess.js";

const reviewerProbeProcessTimeoutMs = 10_000;
const reviewerRuntimeTestTimeoutMs = 20_000;

const profile = {
  agentProfile: "review",
  scope: "global" as const,
  profile: {
    agentRuntime: "pi" as const,
    runtimeConfig: {
      model: "openai-codex/gpt-5.5",
      thinking: "high" as const,
      extensions: [
        "~/.pi/agent/extensions/package-manager-policy",
        "~/.pi/agent/extensions/web-search",
        "~/.pi/agent/extensions/openai-remote-compaction",
      ],
      skills: ["~/.pi/agent/skills/codebase-design"],
      tools: ["read", "bash", "grep", "find", "ls", "web_search", "web_fetch", "web_content_get"],
    },
  },
};

describe("Pi reviewer agent runtime process boundary", () => {
  it.effect(
    "proves normal Pi resources are unavailable in the reviewer process",
    () =>
      Effect.gen(function* () {
        const home = mkdtempSync(join(tmpdir(), "but-why-reviewer-pi-"));
        const workspaceParent = mkdtempSync(join(tmpdir(), "but-why-reviewer-workspace-parent-"));
        const workspace = join(workspaceParent, "snapshot-workspace");
        mkdirSync(workspace, { recursive: true });
        const extensionDir = join(home, ".pi", "agent", "extensions");
        const curatedPolicyDir = join(extensionDir, "package-manager-policy");
        const curatedWebSearchDir = join(extensionDir, "web-search");
        const curatedRemoteCompactionDir = join(extensionDir, "openai-remote-compaction");
        const probeExtension = join(home, "probe.ts");
        const probeOutput = join(home, "probe.json");
        const skillDir = join(home, ".pi", "agent", "skills", "user-normal-skill");
        const curatedSkillDir = join(home, ".pi", "agent", "skills", "codebase-design");
        const promptDir = join(home, ".pi", "agent", "prompts");
        const themeDir = join(home, ".pi", "agent", "themes");
        mkdirSync(extensionDir, { recursive: true });
        mkdirSync(curatedPolicyDir, { recursive: true });
        mkdirSync(curatedWebSearchDir, { recursive: true });
        mkdirSync(curatedRemoteCompactionDir, { recursive: true });
        mkdirSync(skillDir, { recursive: true });
        mkdirSync(curatedSkillDir, { recursive: true });
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
        writeFileSync(
          join(curatedPolicyDir, "package.json"),
          JSON.stringify({ type: "module", pi: { extensions: ["./index.ts"] } }),
        );
        writeFileSync(
          join(curatedPolicyDir, "index.ts"),
          'export default function policy(pi) { pi.registerCommand("curated-policy-command", { description: "curated policy", handler: async () => {} }); }\n',
        );
        writeFileSync(
          join(curatedWebSearchDir, "package.json"),
          JSON.stringify({ type: "module", pi: { extensions: ["./index.ts"] } }),
        );
        writeFileSync(
          join(curatedWebSearchDir, "index.ts"),
          [
            "export default function webSearch(pi) {",
            '  for (const name of ["web_search", "web_fetch", "web_content_get"]) {',
            '    pi.registerTool({ name, label: name, description: name, parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) });',
            "  }",
            '  pi.registerCommand("web-search-status", { description: "web search", handler: async () => {} });',
            "}\n",
          ].join("\n"),
        );
        writeFileSync(
          join(curatedRemoteCompactionDir, "package.json"),
          JSON.stringify({ type: "module", pi: { extensions: ["./index.ts"] } }),
        );
        writeFileSync(
          join(curatedRemoteCompactionDir, "index.ts"),
          "export default function remoteCompaction() {}\n",
        );
        writeFileSync(
          join(curatedSkillDir, "SKILL.md"),
          "---\nname: codebase-design\ndescription: Curated design skill\n---\nCURATED_SKILL_MARKER\n",
        );
        writeFileSync(join(home, ".pi", "agent", "AGENTS.md"), "GLOBAL_AGENTS_MARKER\n");
        writeFileSync(join(workspaceParent, "CLAUDE.md"), "PARENT_CLAUDE_MARKER\n");
        writeFileSync(join(workspace, "AGENTS.md"), "CANDIDATE_AGENTS_MARKER\n");
        writeFileSync(
          probeExtension,
          [
            'import { writeFileSync } from "node:fs";',
            "export default function probe(pi) {",
            '  pi.registerTool({ name: "subagent", label: "Subagent", description: "probe", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) });',
            '  pi.registerCommand("probe-command", { description: "probe", handler: async (_args, ctx) => { writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify({ prompt: ctx.getSystemPrompt(), tools: pi.getActiveTools(), commands: pi.getCommands().map((command) => command.name) })); } });',
            "}",
            "",
          ].join("\n"),
        );

        let commandArgs: readonly string[] = [];
        let processOutput = "";
        const reviewerExecutor = createPiReviewerProcessExecutor((command) =>
          Effect.sync(() => {
            commandArgs = command.args ?? [];
            const rpcArgs = [...commandArgs];
            rpcArgs.splice(rpcArgs.indexOf("-p"), 1);
            rpcArgs[rpcArgs.indexOf("json")] = "rpc";
            const nameIndex = rpcArgs.indexOf("--name");
            rpcArgs.splice(nameIndex, 2);
            rpcArgs.pop();
            rpcArgs.push("--extension", probeExtension);
            const spawned = runTestProcess(command.command, rpcArgs, {
              cwd: workspace,
              env: { PI_OFFLINE: "1", PROBE_OUTPUT: probeOutput },
              isolatedHome: home,
              input:
                '{"type":"get_commands","id":"commands"}\n{"type":"prompt","message":"/probe-command","id":"probe"}\n',
              timeout: reviewerProbeProcessTimeoutMs,
            });
            if (spawned.error) throw spawned.error;
            if (spawned.status !== 0) {
              throw new Error(spawned.stderr || `Pi exited with ${spawned.status}`);
            }
            processOutput = spawned.stdout;
            return {
              exitCode: 0,
              stderr: "",
              stdout: `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: '<reviewer-output>{"findings":[]}</reviewer-output>' }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } })}\n`,
            };
          }),
        );

        try {
          const result = yield* piReviewerAgentRuntime.review({
            reviewerExecutor,
            reviewer: "acceptance",
            decodeOutput: decodeEmptyFindings,
            prompt: "Review the Candidate.",
            profile,
          });

          expect(result).toMatchObject({ ok: true, attempts: 1 });
          expect(commandArgs).toContain("--no-extensions");
          expect(commandArgs).toContain("--no-skills");
          expect(commandArgs).toContain("--no-prompt-templates");
          expect(commandArgs).toContain("--no-themes");
          expect(commandArgs).not.toContain("--no-context-files");
          expect(commandArgs).toContain("~/.pi/agent/extensions/package-manager-policy");
          expect(commandArgs).toContain("~/.pi/agent/extensions/web-search");
          expect(commandArgs).toContain("~/.pi/agent/extensions/openai-remote-compaction");
          expect(commandArgs).toContain("~/.pi/agent/skills/codebase-design");
          const probe = JSON.parse(readFileSync(probeOutput, "utf8")) as {
            readonly prompt: string;
            readonly tools: readonly string[];
            readonly commands: readonly string[];
          };
          expect(processOutput).not.toContain("user-normal-extension");
          expect(processOutput).not.toContain("user-normal-skill");
          expect(processOutput).not.toContain("user-normal-prompt");
          expect(probe.prompt).toContain("GLOBAL_AGENTS_MARKER");
          expect(probe.prompt).toContain("PARENT_CLAUDE_MARKER");
          expect(probe.prompt).toContain("CANDIDATE_AGENTS_MARKER");
          expect(probe.prompt).toContain("codebase-design");
          expect(probe.prompt).not.toContain("USER_NORMAL_CONTEXT_MARKER");
          expect(probe.prompt).not.toContain("CANDIDATE_CONTEXT_MARKER");
          expect(probe.tools).toEqual([
            "read",
            "bash",
            "grep",
            "find",
            "ls",
            "web_search",
            "web_fetch",
            "web_content_get",
          ]);
          expect(probe.tools).not.toContain("subagent");
          expect(probe.tools).not.toContain("edit");
          expect(probe.tools).not.toContain("write");
          expect(probe.commands).toContain("curated-policy-command");
          expect(probe.commands).toContain("skill:codebase-design");
          expect(probe.commands).toContain("web-search-status");
          expect(probe.commands).not.toContain("user-normal-extension");
          expect(probe.commands).not.toContain("user-normal-skill");
          expect(probe.commands).not.toContain("user-normal-prompt");
        } finally {
          rmSync(home, { recursive: true, force: true });
          rmSync(workspaceParent, { recursive: true, force: true });
        }
      }),
    reviewerRuntimeTestTimeoutMs,
  );
});
