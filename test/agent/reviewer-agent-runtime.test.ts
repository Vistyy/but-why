import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import {
  decodeReviewerOutputContract,
  validateReviewerArtifactRefs,
} from "../../src/contracts/reviewerOutput.js";

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
        prompt: "Review the Candidate.",
        profile,
        agentEnvironment: ["nix", "develop", "-c"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(command).toBe(
        "'nix' 'develop' '-c' pi -p --mode json --model 'openai-codex/gpt-5.5' --thinking high --no-prompt-templates --no-themes --no-extensions --extension '~/.pi/agent/extensions/package-manager-policy' --extension '~/.pi/agent/extensions/web-search' --extension '~/.pi/agent/extensions/openai-remote-compaction' --no-skills --skill '~/.pi/agent/skills/codebase-design' --tools 'read,bash,grep,find,ls,web_search,web_fetch,web_content_get'",
      );
      expect(command).not.toContain("--subagent");
      expect(command).not.toContain("--edit");
      expect(command).not.toContain("--write");
    }),
  );

  it.effect("stores host-run Pi sessions in the Change-owned session directory", () =>
    Effect.gen(function* () {
      const { fixtureRoot, sessionRoot } = isolatedSessionRoot();
      const workspace = "/validation-workspace-two";
      const sessionId = "123e4567-e89b-42d3-a456-426614174001";
      let command = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        command = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        }).command;
        writeFileSync(join(sessionRoot, `review_${sessionId}.jsonl`), '{"type":"session"}\n');
        return {
          ...runResult('<reviewer-output>{"findings":[]}</reviewer-output>'),
          iterations: [{ sessionId }],
        };
      };

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          prompt: "Review the Candidate.",
          profile,
          commandCwd: workspace,
          sessionStorageRoot: sessionRoot,
        });

        expect(command).toContain(`--session-dir '${sessionRoot}'`);
        expect(result).toMatchObject({
          ok: true,
          sessionReference: sessionId,
          sessionFilePath: expect.stringContaining(`review_${sessionId}.jsonl`),
        });
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
  );

  it.effect("does not promote session metadata after capture-failure recovery", () =>
    Effect.gen(function* () {
      const { fixtureRoot, sessionRoot } = isolatedSessionRoot();
      const sessionId = "123e4567-e89b-42d3-a456-426614174003";
      const sessionFile = join(sessionRoot, `review_${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        `{"type":"session","id":"${sessionId}","cwd":"/removed-workspace"}\n`,
      );
      const observedCwds: string[] = [];
      let attempts = 0;
      const run: Pick<Sandbox, "run">["run"] = async () => {
        attempts += 1;
        const header = JSON.parse(readFileSync(sessionFile, "utf8")) as { cwd: string };
        observedCwds.push(header.cwd);
        if (attempts === 1) throw new Error("Session capture failed");
        return {
          ...runResult('<reviewer-output>{"findings":[]}</reviewer-output>'),
          iterations: [{ sessionId }],
        };
      };

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          prompt: "Review the Candidate.",
          profile,
          commandCwd: "/validation-workspace",
          sessionStorageRoot: sessionRoot,
          resumeSession: sessionId,
        });

        expect(result).toEqual({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
        });
        expect(attempts).toBe(2);
        expect(observedCwds).toEqual(["/validation-workspace", "/validation-workspace"]);
        expect(readFileSync(sessionFile, "utf8")).toContain('"cwd":"/removed-workspace"');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rejects a corrupt stored Pi session before resume", () =>
    Effect.gen(function* () {
      const { fixtureRoot, sessionRoot } = isolatedSessionRoot();
      const sessionId = "123e4567-e89b-42d3-a456-426614174002";
      writeFileSync(join(sessionRoot, `review_${sessionId}.jsonl`), "not-json\n");
      const run = vi.fn<Pick<Sandbox, "run">["run"]>(() =>
        Promise.resolve(runResult('<reviewer-output>{"findings":[]}</reviewer-output>')),
      );

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          prompt: "Review the Candidate.",
          profile,
          commandCwd: "/validation-workspace",
          sessionStorageRoot: sessionRoot,
          resumeSession: sessionId,
        });

        expect(result).toMatchObject({
          ok: false,
          failure: {
            _tag: "SandcastleToolingFailed",
            message: "Reviewer Session JSONL is corrupt.",
          },
          sessionUsability: "unusable",
        });
        expect(run).not.toHaveBeenCalled();
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rejects a non-object Pi session entry before resume", () =>
    Effect.gen(function* () {
      const { fixtureRoot, sessionRoot } = isolatedSessionRoot();
      const sessionId = "123e4567-e89b-42d3-a456-426614174002";
      writeFileSync(join(sessionRoot, `review_${sessionId}.jsonl`), "null\n");
      const run = vi.fn<Pick<Sandbox, "run">["run"]>(() =>
        Promise.resolve(runResult('<reviewer-output>{"findings":[]}</reviewer-output>')),
      );

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          prompt: "Review the Candidate.",
          profile,
          commandCwd: "/validation-workspace",
          sessionStorageRoot: sessionRoot,
          resumeSession: sessionId,
        });

        expect(result).toMatchObject({
          ok: false,
          failure: {
            _tag: "SandcastleToolingFailed",
            message: "Reviewer Session JSONL is corrupt.",
          },
          sessionUsability: "unusable",
        });
        expect(run).not.toHaveBeenCalled();
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
  );

  it.effect("preserves unknown Pi JSONL content while rewriting the session header", () =>
    Effect.gen(function* () {
      const { fixtureRoot, sessionRoot } = isolatedSessionRoot();
      const sessionId = "123e4567-e89b-42d3-a456-426614174005";
      const sessionFile = join(sessionRoot, `review_${sessionId}.jsonl`);
      writeFileSync(
        sessionFile,
        [
          `{"type":"session","id":"${sessionId}","cwd":"/original-workspace","vendor":{"name":"pi"}}`,
          '{"type":"message","role":"user","content":"hello"}',
          "",
        ].join("\n"),
      );
      let rewritten = "";
      const run: Pick<Sandbox, "run">["run"] = async () => {
        rewritten = readFileSync(sessionFile, "utf8");
        return {
          ...runResult('<reviewer-output>{"findings":[]}</reviewer-output>'),
          iterations: [{ sessionId }],
        };
      };

      try {
        const result = yield* piReviewerAgentRuntime.review({
          sandbox: { run } as unknown as Pick<Sandbox, "run">,
          reviewer: "acceptance",
          prompt: "Review the Candidate.",
          profile,
          commandCwd: "/validation-workspace",
          sessionStorageRoot: sessionRoot,
          resumeSession: sessionId,
        });

        expect(result).toMatchObject({ ok: true, attempts: 1 });
        const lines = rewritten.split("\n");
        const header = JSON.parse(lines[0] ?? "") as { cwd: string; vendor: { name: string } };
        expect(header.cwd).toBe("/validation-workspace");
        expect(header.vendor).toEqual({ name: "pi" });
        expect(lines[1]).toBe('{"type":"message","role":"user","content":"hello"}');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }),
  );

  it.effect("resolves Repo resources from the Managed Worktree root", () =>
    Effect.gen(function* () {
      let command = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        command = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        }).command;
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile: {
          ...profile,
          scope: "repo",
          profile: {
            ...profile.profile,
            runtimeConfig: {
              ...profile.profile.runtimeConfig,
              extensions: ["extensions/reviewer"],
              skills: ["skills/reviewer"],
            },
          },
        },
        commandCwd: "/validation-workspace",
        resourceRoot: "/managed-worktree",
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(command).toContain("--extension '/managed-worktree/extensions/reviewer'");
      expect(command).toContain("--skill '/managed-worktree/skills/reviewer'");
      expect(command).not.toContain("/validation-workspace");
    }),
  );

  it.effect("preserves Global Pi package URL sources", () =>
    Effect.gen(function* () {
      let command = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        command = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        }).command;
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile: {
          ...profile,
          profile: {
            ...profile.profile,
            runtimeConfig: {
              ...profile.profile.runtimeConfig,
              extensions: [
                "https://github.com/user/reviewer-extension",
                "ssh://git@github.com/user/another-extension",
              ],
            },
          },
        },
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(command).toContain("--extension 'https://github.com/user/reviewer-extension'");
      expect(command).toContain("--extension 'ssh://git@github.com/user/another-extension'");
      expect(command).not.toContain(".config");
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
        prompt: "Review the Candidate.",
        profile,
        agentEnvironment: ["nix", "develop", "-c"],
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 1,
        failure: { _tag: "SandcastleToolingFailed", message: "wrapper failed" },
        sessionUsability: "unknown",
      });
      expect(command.startsWith("'nix' 'develop' '-c' pi ")).toBe(true);
      expect(attempts).toBe(1);
    }),
  );

  it.effect("retries when an injected output contract rejects an Artifact reference", () =>
    Effect.gen(function* () {
      const corrected = runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resume = vi.fn(() => Promise.resolve(corrected));
      const dangling = runResult(
        '<reviewer-output>{"findings":[{"title":"Mismatch","description":"Incomplete behavior.","evidence":"Missing output.","files":[],"artifactRefs":["artifact:123e4567-e89b-42d3-a456-426614174000/checks/missing/stdout.txt"]}]}</reviewer-output>',
        resume,
      );

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run: () => Promise.resolve(dangling) } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        outputContract: (input) =>
          decodeReviewerOutputContract(input).pipe(
            Effect.flatMap((output) =>
              validateReviewerArtifactRefs({
                ...input,
                validationRunId: "123e4567-e89b-42d3-a456-426614174000",
                availableArtifactRefs: [],
                output,
              }),
            ),
          ),
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, attempts: 2, report: { findings: [] } });
      expect(resume).toHaveBeenCalledWith(expect.stringContaining("does not resolve"));
    }),
  );

  it.effect("accepts a corrected report on the third attempt", () =>
    Effect.gen(function* () {
      const third = runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resumeSecond = vi.fn(() => Promise.resolve(third));
      const second = runResult(
        '<reviewer-output>{"findings":"wrong"}</reviewer-output>',
        resumeSecond,
      );
      const resumeFirst = vi.fn(() => Promise.resolve(second));
      const first = runResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Promise.resolve(first));

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toEqual({
        ok: true,
        report: { findings: [] },
        attempts: 3,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
      expect(resumeSecond).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledWith(expect.stringContaining("$: Expected"));
      expect(resumeSecond).toHaveBeenCalledWith(
        expect.stringContaining("findings: Expected ReadonlyArray"),
      );
    }),
  );

  it.effect("fails after three invalid outputs without a fourth invocation", () =>
    Effect.gen(function* () {
      const resumeThird = vi.fn(() => Promise.resolve(runResult("must not run")));
      const third = runResult(
        '<reviewer-output>{"findings":[{"title":"T"}]}</reviewer-output>',
        resumeThird,
      );
      const resumeSecond = vi.fn(() => Promise.resolve(third));
      const second = runResult(
        '<reviewer-output>{"findings":"wrong"}</reviewer-output>',
        resumeSecond,
      );
      const resumeFirst = vi.fn(() => Promise.resolve(second));
      const first = runResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Promise.resolve(first));

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 3,
        failure: {
          _tag: "ReviewerOutputContractFailed",
          reviewer: "acceptance",
          attempts: 3,
        },
        sessionUsability: "unknown",
        stdout: '<reviewer-output>{"findings":[{"title":"T"}]}</reviewer-output>',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
      expect(resumeSecond).toHaveBeenCalledTimes(1);
      expect(resumeThird).not.toHaveBeenCalled();
      expect(resumeFirst).toHaveBeenCalledWith(expect.stringContaining("$: Expected"));
      expect(resumeSecond).toHaveBeenCalledWith(
        expect.stringContaining("findings: Expected ReadonlyArray"),
      );
    }),
  );

  it.effect("stops after a failed output correction invocation", () =>
    Effect.gen(function* () {
      const resumeFirst = vi.fn(() => Promise.reject(new Error("provider failed")));
      const first = runResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Promise.resolve(first));

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 2,
        failure: { _tag: "SandcastleToolingFailed", message: "provider failed" },
        sessionUsability: "unknown",
        stdout: "<reviewer-output>not json</reviewer-output>",
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
    }),
  );
});

const isolatedSessionRoot = (): { readonly fixtureRoot: string; readonly sessionRoot: string } => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-reviewer-session-fixture-"));
  const sessionRoot = join(fixtureRoot, "sessions");
  mkdirSync(sessionRoot, { recursive: true });
  return { fixtureRoot, sessionRoot };
};

const runResult = (stdout: string, resume?: SandboxRunResult["resume"]): SandboxRunResult => ({
  iterations: [],
  stdout,
  commits: [],
  ...(resume === undefined ? {} : { resume }),
});
