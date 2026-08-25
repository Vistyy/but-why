import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTestProcessExpectExit, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });

describe("Git push destination binding", () => {
  it("resolves effective destinations and binds a checked destination across later config changes", () => {
    const root = createTestWorkspace();
    const source = join(root, "source");
    const intended = join(root, "intended.git");
    const redirected = join(root, "redirected.git");
    git(root, "init", "--bare", intended);
    git(root, "init", "--bare", redirected);
    git(root, "init", source);
    git(source, "config", "user.email", "test@example.com");
    git(source, "config", "user.name", "Test User");
    writeFileSync(join(source, "file.txt"), "candidate\n");
    git(source, "add", "file.txt");
    git(source, "commit", "-m", "candidate");
    const candidate = git(source, "rev-parse", "HEAD");
    git(source, "remote", "add", "origin", intended);

    git(source, "config", "--add", "remote.origin.pushurl", intended);
    git(source, "config", "--add", "remote.origin.pushurl", redirected);
    expect(git(source, "remote", "get-url", "--push", "--all", "origin").split("\n")).toEqual([
      intended,
      redirected,
    ]);
    git(source, "config", "--unset-all", "remote.origin.pushurl");

    git(source, "config", `url.${intended}.pushInsteadOf`, "publish-alias");
    git(source, "remote", "set-url", "origin", "publish-alias");
    expect(git(source, "remote", "get-url", "--push", "--all", "origin")).toBe(intended);
    const checkedDestination = intended;

    git(source, "remote", "set-url", "--push", "origin", redirected);
    git(source, "config", `url.${redirected}.pushInsteadOf`, intended);
    git(
      source,
      "-c",
      `url.${checkedDestination}.pushInsteadOf=${checkedDestination}`,
      "push",
      checkedDestination,
      `${candidate}:refs/heads/candidate`,
    );

    expect(git(intended, "rev-parse", "refs/heads/candidate")).toBe(candidate);
    const missingCandidate = runTestProcessExpectExit(
      "git",
      ["rev-parse", "--verify", "refs/heads/candidate"],
      { cwd: redirected },
      128,
    );
    expect(missingCandidate.stderr).not.toBe("");
  });
});
