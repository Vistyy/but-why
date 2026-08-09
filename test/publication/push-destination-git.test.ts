import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTestProcess } from "../support/testProcess.js";

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = runTestProcess("git", args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

describe("Git push destination binding", () => {
  it("resolves effective destinations and binds a checked destination across later config changes", () => {
    const root = mkdtempSync(join(tmpdir(), "by-push-destination-"));
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

    expect(
      git(
        source,
        "-c",
        `url.${checkedDestination}.insteadOf=${checkedDestination}`,
        "ls-remote",
        "--heads",
        checkedDestination,
        "refs/heads/candidate",
      ).split(/\s/u)[0],
    ).toBe(candidate);
    expect(git(intended, "rev-parse", "refs/heads/candidate")).toBe(candidate);
    expect(
      runTestProcess("git", ["rev-parse", "--verify", "refs/heads/candidate"], { cwd: redirected })
        .status,
    ).not.toBe(0);
  });
});
