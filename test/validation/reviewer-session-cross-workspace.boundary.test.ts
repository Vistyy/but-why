import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSandbox } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import { runTestProcess } from "../support/testProcess.js";

const profile = {
  agentProfile: "reviewer",
  scope: "global" as const,
  profile: {
    agentRuntime: "pi" as const,
    runtimeConfig: { model: "test/reviewer" },
  },
};

it.effect(
  "resumes one Change-owned Pi session after the first Validation Workspace is removed",
  () =>
    Effect.gen(function* () {
      const repository = mkdtempSync(join(tmpdir(), "but-why-reviewer-repository-"));
      const sessionRoot = join(repository, ".reviewer-sessions");
      const fakeBin = join(repository, ".fake-bin");
      const trace = join(repository, "reviewer-trace.txt");
      const sandcastleGitConfig = join(repository, "sandcastle.gitconfig");
      mkdirSync(fakeBin);
      const fakePi = join(fakeBin, "pi");
      writeFileSync(
        fakePi,
        `#!/bin/sh
set -eu
prompt=$(cat)
session_id=""
session_root=""
previous=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session)
      shift
      session_id="$1"
      ;;
    --session-dir)
      shift
      session_root="$1"
      ;;
  esac
  shift
done
[ -n "$session_root" ] || exit 43
PI_CODING_AGENT_SESSION_DIR="$session_root"
export PI_CODING_AGENT_SESSION_DIR
if [ -n "$session_id" ]; then
  previous=$(find "$PI_CODING_AGENT_SESSION_DIR" -type f -name "*_$session_id.jsonl" -print -quit)
  [ -n "$previous" ] || exit 44
  grep -F '\"cwd\":\"'"$(pwd)"'\"' "$previous" >/dev/null || exit 45
  session_file="$previous"
  mode=resumed
else
  session_id=123e4567-e89b-42d3-a456-426614174099
  mkdir -p "$PI_CODING_AGENT_SESSION_DIR"
  session_file="$PI_CODING_AGENT_SESSION_DIR/review_$session_id.jsonl"
  mode=fresh
fi
printf '{"type":"session","id":"%s","cwd":"%s"}\n' "$session_id" "$(pwd)" >> "$session_file"
printf '%s|%s|%s\n' "$mode" "$(pwd)" "$prompt" >> "$FAKE_PI_TRACE"
printf '{"type":"session","id":"%s"}\n' "$session_id"
printf '%s\n' '{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"<reviewer-output>{\\"findings\\":[]}</reviewer-output>"}]}]}'
`,
      );
      chmodSync(fakePi, 0o700);
      git(repository, ["init"]);
      writeFileSync(join(repository, "candidate.txt"), "base\n");
      git(repository, ["add", "."]);
      git(repository, [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "base",
      ]);
      git(repository, ["branch", "validation-one"]);
      git(repository, ["branch", "validation-two"]);

      const environment = [
        "env",
        // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires indexed access under the project TypeScript settings.
        `PATH=${fakeBin}:${process.env["PATH"] ?? ""}`,
        `FAKE_PI_TRACE=${trace}`,
      ] as const;
      let firstWorkspacePath = "";

      try {
        const firstWorkspace = yield* Effect.promise(() =>
          createSandbox({
            cwd: repository,
            branch: "refs/heads/validation-one",
            sandbox: noSandbox({ env: { GIT_CONFIG_GLOBAL: sandcastleGitConfig } }),
          }),
        );
        firstWorkspacePath = firstWorkspace.worktreePath;
        const first = yield* piReviewerAgentRuntime.review({
          sandbox: firstWorkspace,
          reviewer: "acceptance",
          validationRunId: "123e4567-e89b-42d3-a456-426614174001",
          availableArtifactRefs: [],
          prompt: "FIRST-CANDIDATE",
          profile,
          commandCwd: firstWorkspace.worktreePath,
          sessionStorageRoot: sessionRoot,
          agentEnvironment: environment,
        });
        yield* Effect.promise(() => firstWorkspace.close());

        if (!first.ok) return yield* Effect.dieMessage("First Acceptance Review failed.");
        expect(first).toMatchObject({
          ok: true,
          sessionReference: "123e4567-e89b-42d3-a456-426614174099",
        });
        if (!first.ok || first.sessionReference === undefined) {
          return yield* Effect.dieMessage("First review did not capture a Reviewer Session.");
        }
        expect(() => readFileSync(join(firstWorkspacePath, "candidate.txt"))).toThrow();

        const secondWorkspace = yield* Effect.promise(() =>
          createSandbox({
            cwd: repository,
            branch: "refs/heads/validation-two",
            sandbox: noSandbox({ env: { GIT_CONFIG_GLOBAL: sandcastleGitConfig } }),
          }),
        );
        const second = yield* piReviewerAgentRuntime.review({
          sandbox: secondWorkspace,
          reviewer: "acceptance",
          validationRunId: "123e4567-e89b-42d3-a456-426614174002",
          availableArtifactRefs: [],
          prompt: "SECOND-CANDIDATE",
          profile,
          commandCwd: secondWorkspace.worktreePath,
          sessionStorageRoot: sessionRoot,
          resumeSession: first.sessionReference,
          agentEnvironment: environment,
        });
        yield* Effect.promise(() => secondWorkspace.close());

        expect(second).toMatchObject({
          ok: true,
          sessionReference: "123e4567-e89b-42d3-a456-426614174099",
        });
        const observations = readFileSync(trace, "utf8").split("\n");
        expect(
          observations.some(
            (line) => line.startsWith("fresh|") && line.endsWith("|FIRST-CANDIDATE"),
          ),
        ).toBe(true);
        expect(
          observations.some(
            (line) => line.startsWith("resumed|") && line.endsWith("|SECOND-CANDIDATE"),
          ),
        ).toBe(true);
      } finally {
        rmSync(repository, { recursive: true, force: true });
      }
    }),
);

const git = (cwd: string, args: readonly string[]): void => {
  const result = runTestProcess("git", args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
};
